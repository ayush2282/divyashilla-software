import type { Config } from '../../config.js';
import type { Database, SqlExecutor } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { writeActivity } from '../audit/activity-log.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { hashToken, issueSession, tokenPattern } from './sessions.js';
import { publicUser, type AuthContext, type UserRow } from './types.js';

const userColumns = 'id,name,username,role,password_hash,is_active,must_change_password';
const badLogin = () => new AppError(401,'INVALID_CREDENTIALS','Incorrect username or password.');

export function authService(db: Database, config: Config) {
  return {
    async login(username: string, password: string, requestId: string, previousToken?: string) {
      const found = await db.query<UserRow>(`SELECT ${userColumns} FROM divyashilla.users WHERE lower(username) = $1`,[username]);
      const candidate = found.rows[0];
      const valid = await verifyPassword(password,candidate?.password_hash ?? dummyHash);
      if (!candidate || !valid || !candidate.is_active) {
        await writeActivity(db,{actorId:candidate?.id ?? null,action:'AUTH_LOGIN_FAILED',entityType:'AUTH',requestId});
        throw badLogin();
      }
      return db.transaction(async tx => {
        const current = (await tx.query<UserRow>(`SELECT ${userColumns} FROM divyashilla.users WHERE id = $1 FOR UPDATE`,[candidate.id])).rows[0];
        // Prevent a password reset/deactivation racing a slow password verification.
        if (!current || !current.is_active || current.password_hash !== candidate.password_hash) throw badLogin();
        if (previousToken && tokenPattern.test(previousToken)) {
          await tx.query(`UPDATE divyashilla.sessions SET revoked_at = clock_timestamp()
            WHERE token_hash = $1 AND revoked_at IS NULL`,[hashToken(previousToken)]);
        }
        const session = await issueSession(tx,current.id,config.SESSION_HOURS);
        await tx.query('UPDATE divyashilla.users SET last_login_at = clock_timestamp() WHERE id = $1',[current.id]);
        await writeActivity(tx,{actorId:current.id,action:'AUTH_LOGIN_SUCCEEDED',entityType:'USER',entityId:current.id,requestId});
        return {user:publicUser(current),session};
      });
    },

    async logout(auth: AuthContext, requestId: string) {
      await db.transaction(async tx => {
        await lockCurrentSession(tx,auth);
        await tx.query('UPDATE divyashilla.sessions SET revoked_at = clock_timestamp() WHERE id = $1',[auth.sessionId]);
        await writeActivity(tx,{actorId:auth.user.id,action:'AUTH_LOGOUT',entityType:'USER',entityId:auth.user.id,requestId});
      });
    },

    async changePassword(auth: AuthContext, currentPassword: string, newPassword: string, requestId: string) {
      if (currentPassword === newPassword) throw new AppError(400,'PASSWORD_UNCHANGED','Choose a different new password.');
      const newHash = await hashPassword(newPassword);
      return db.transaction(async tx => {
        const user = await lockCurrentSession(tx,auth);
        if (!await verifyPassword(currentPassword,user.password_hash)) {
          throw new AppError(401,'INVALID_CURRENT_PASSWORD','Current password is incorrect.');
        }
        await tx.query(`UPDATE divyashilla.users SET password_hash = $2,must_change_password = false WHERE id = $1`,[user.id,newHash]);
        const revoked = await tx.query(`UPDATE divyashilla.sessions SET revoked_at = clock_timestamp()
          WHERE user_id = $1 AND revoked_at IS NULL`,[user.id]);
        const session = await issueSession(tx,user.id,config.SESSION_HOURS);
        await writeActivity(tx,{actorId:user.id,action:'AUTH_PASSWORD_CHANGED',entityType:'USER',entityId:user.id,
          after:{mustChangePassword:false,revokedSessions:revoked.rowCount ?? 0},requestId});
        return {user:{...publicUser(user),mustChangePassword:false},session};
      });
    }
  };
}

async function lockCurrentSession(tx: SqlExecutor, auth: AuthContext) {
  const user = (await tx.query<UserRow>(`SELECT ${userColumns} FROM divyashilla.users WHERE id = $1 FOR UPDATE`,[auth.user.id])).rows[0];
  const session = await tx.query(`SELECT id FROM divyashilla.sessions WHERE id = $1 AND user_id = $2
    AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`,[auth.sessionId,auth.user.id]);
  if (!user?.is_active || session.rows.length !== 1) throw new AppError(401,'SESSION_INVALID','Please log in again.');
  return user;
}
