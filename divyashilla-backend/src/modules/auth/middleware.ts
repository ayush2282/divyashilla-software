import type { RequestHandler } from 'express';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { clearSessionCookie, csrfMatches, hashToken, tokenPattern } from './sessions.js';
import { publicUser, type Role, type UserRow } from './types.js';

export function requireAuth(db: Database, config: Config): RequestHandler {
  return async (req,res,next) => {
    const token: unknown = req.cookies?.[config.cookieName];
    if (typeof token !== 'string' || !tokenPattern.test(token)) {
      clearSessionCookie(res,config);
      throw new AppError(401,'LOGIN_REQUIRED','Please log in.');
    }
    const result = await db.query<UserRow & {session_id: string; expires_at: Date}>(`SELECT
      u.id,u.name,u.username,u.role,u.password_hash,u.is_active,u.must_change_password,
      s.id AS session_id,s.expires_at FROM divyashilla.sessions s
      JOIN divyashilla.users u ON u.id = s.user_id WHERE s.token_hash = $1
      AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() AND u.is_active = true`,[hashToken(token)]);
    const row = result.rows[0];
    if (!row) { clearSessionCookie(res,config); throw new AppError(401,'SESSION_INVALID','Please log in again.'); }
    req.auth = {user:publicUser(row),sessionId:row.session_id,rawToken:token,expiresAt:row.expires_at};
    next();
  };
}

export function requireRoles(...roles: Role[]): RequestHandler {
  return (req,_res,next) => {
    if (!req.auth) throw new AppError(401,'LOGIN_REQUIRED','Please log in.');
    if (!roles.includes(req.auth.user.role)) throw new AppError(403,'FORBIDDEN','You do not have permission.');
    if (req.auth.user.mustChangePassword) throw new AppError(403,'PASSWORD_CHANGE_REQUIRED','Change your temporary password first.');
    next();
  };
}

export function requireTrustedOrigin(config: Config): RequestHandler {
  return (req,_res,next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) { next(); return; }
    if (!req.get('Origin') || !config.allowedOrigins.includes(req.get('Origin')!)) {
      throw new AppError(403,'UNTRUSTED_ORIGIN','Use an allowed application origin.');
    }
    next();
  };
}

export function requireCsrf(config: Config): RequestHandler {
  return (req,_res,next) => {
    if (!req.auth) throw new AppError(401,'LOGIN_REQUIRED','Please log in.');
    if (!csrfMatches(req.get('X-CSRF-Token'),req.auth.rawToken,config.CSRF_SECRET)) {
      throw new AppError(403,'CSRF_INVALID','Refresh your session and retry.');
    }
    next();
  };
}
