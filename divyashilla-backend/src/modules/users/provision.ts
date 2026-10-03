import type { Database } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { writeActivity } from '../audit/activity-log.js';
import { hashPassword } from '../auth/password.js';
import { publicUser, type UserRow } from '../auth/types.js';
import { createUserSchema } from '../auth/validation.js';

// Local administrator command only. No public registration API exists.
export async function provisionUser(db: Database, input: unknown) {
  const user = createUserSchema.parse(input);
  const hash = await hashPassword(user.password);
  return db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock($1)',[7741002]);
    const existing = await tx.query<{count: string}>("SELECT count(*)::text AS count FROM divyashilla.users WHERE role = 'ADMIN' AND is_active");
    if (existing.rows[0]?.count === '0' && user.role !== 'ADMIN') {
      throw new AppError(400,'ADMIN_REQUIRED','Create an ADMIN account first.');
    }
    const result = await tx.query<UserRow>(`INSERT INTO divyashilla.users
      (name,username,password_hash,role,must_change_password) VALUES ($1,$2,$3,$4,true)
      RETURNING id,name,username,role,password_hash,is_active,must_change_password`,[user.name,user.username,hash,user.role]);
    const safe = publicUser(result.rows[0]!);
    await writeActivity(tx,{actorId:null,action:'USER_CREATED',entityType:'USER',entityId:safe.id,
      after:{id:safe.id,name:safe.name,username:safe.username,role:safe.role,mustChangePassword:true},reason:'Local administrator provisioning'});
    return safe;
  });
}
