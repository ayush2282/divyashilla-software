import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import type { Config } from '../../config.js';
import type { SqlExecutor } from '../../db/database.js';

export const tokenPattern = /^[a-f0-9]{64}$/;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const csrfToken = (token: string, secret: string) => createHmac('sha256', secret).update(token).digest('hex');
export function csrfMatches(received: string | undefined, token: string, secret: string) {
  if (!received || !tokenPattern.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(csrfToken(token, secret), 'hex'));
}
export async function issueSession(tx: SqlExecutor, userId: string, hours: number) {
  const token = randomBytes(32).toString('hex');
  const result = await tx.query<{id: string; expires_at: Date}>(`INSERT INTO divyashilla.sessions
    (user_id,token_hash,expires_at) VALUES ($1,$2,clock_timestamp() + $3::integer * interval '1 hour')
    RETURNING id,expires_at`, [userId,hashToken(token),hours]);
  const row = result.rows[0]!;
  return { token, sessionId: row.id, expiresAt: row.expires_at };
}
function cookieOptions(config: Config) {
  return {httpOnly:true,secure:config.secureCookie,sameSite:'lax' as const,path:'/'};
}
export function setSessionCookie(res: Response, config: Config, session: {token: string; expiresAt: Date}) {
  res.cookie(config.cookieName,session.token,{...cookieOptions(config),expires:session.expiresAt});
}
export function clearSessionCookie(res: Response, config: Config) {
  res.clearCookie(config.cookieName,cookieOptions(config));
}
