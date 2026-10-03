import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 32768, r = 8, p = 3, keyLength = 64;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, 'hex'), keyLength,
    { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (!match?.[1] || !match[2]) return false;
  const actual = await derive(password, match[1]);
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}
// Unknown usernames still perform the same expensive verification work.
export const dummyHash = `scrypt$32768$8$3$${'0'.repeat(32)}$${'0'.repeat(128)}`;
