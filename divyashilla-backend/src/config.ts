import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform(value => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FILES_DRIVER:z.enum(['local','azure']).default('local'),
  AZURE_STORAGE_ACCOUNT:z.string().default(''),
  AZURE_STORAGE_CONTAINER:z.string().default(''),
  FRONTEND_DIRECTORY:z.string().default(''),
  FILES_DIRECTORY:z.string().min(1).default('./var/private-files'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().default(''),
  PG_SSL: booleanString.default(false),
  CSRF_SECRET: z.string().regex(/^[a-f0-9]{64,}$/i),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  ENABLE_CONTAINS_SEARCH: booleanString.default(true),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0)
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))];
    throw new Error(`Invalid configuration: ${names.join(', ')}. See .env.example.`);
  }
  const config = parsed.data;
  for (const value of [config.DATABASE_URL, config.MIGRATION_DATABASE_URL].filter(Boolean)) {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.size > 0) {
      throw new Error('Use a PostgreSQL URL without query options; configure TLS with PG_SSL.');
    }
  }
  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean);
  if (allowedOrigins.length === 0 || allowedOrigins.some(value => {
    try { const u = new URL(value); return !['http:', 'https:'].includes(u.protocol) || u.origin !== value; }
    catch { return true; }
  })) throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins without trailing slashes.');
  if (config.NODE_ENV === 'production' && (!config.PG_SSL || allowedOrigins.some(value => !value.startsWith('https://')))) {
    throw new Error('Production requires database TLS and HTTPS origins.');
  }
  if (config.FILES_DRIVER==='azure' && (!/^[a-z0-9]{3,24}$/.test(config.AZURE_STORAGE_ACCOUNT) || !/^(?!.*--)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.AZURE_STORAGE_CONTAINER))) throw new Error('Azure storage requires a valid account and private container name.');
  if (config.NODE_ENV==='production' && config.FILES_DRIVER!=='azure') throw new Error('Production requires FILES_DRIVER=azure.');
  return {
    ...config, allowedOrigins,
    cookieName: config.NODE_ENV === 'production' ? '__Host-divyashilla_session' : 'divyashilla_session',
    secureCookie: config.NODE_ENV === 'production'
  };
}
export type Config = ReturnType<typeof loadConfig>;
