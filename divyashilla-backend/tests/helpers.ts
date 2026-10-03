import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import type { Database, ScriptExecutor, SqlExecutor } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations.js';
import type { Response } from 'supertest';

export const origin = 'http://localhost:3000';
export const testPassword = 'Test-only-password-123!';
export const config = loadConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@localhost/test',
  CSRF_SECRET:'a'.repeat(64),ALLOWED_ORIGINS:origin});

function adapter(client: Pick<PGlite,'query'>): SqlExecutor {
  return {query:async <T extends object>(sql: string,values?: unknown[]) => {
    const result = await client.query<T>(sql,values);
    return {rows:result.rows,rowCount:result.affectedRows ?? null};
  }};
}
export async function fixture() {
  const pg = new PGlite({extensions:{pg_trgm}});
  const sql = adapter(pg);
  const db: Database = {...sql,transaction:work => pg.transaction(tx => work(adapter(tx)))};
  const migrationClient: ScriptExecutor = {...sql,exec:async text => {await pg.exec(text);}};
  await runMigrations(migrationClient,resolve('migrations'),true,() => {});
  return {pg,db,migrationClient,app:createApp(db,config)};
}
export function cookie(response: Response): string {
  const header = response.headers['set-cookie'] as string[] | undefined;
  if (!header?.[0]) throw new Error('Expected session cookie');
  return header[0].split(';')[0]!;
}
