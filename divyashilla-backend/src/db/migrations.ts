import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScriptExecutor } from './database.js';

const lockId = 7741001;

// Keep the original files unchanged. Move their OUTER transaction into the runner
// so applying SQL and recording its checksum commit together.
export function migrationBody(sql: string) {
  const begin = /^BEGIN;\s*$/m;
  const commit = /^COMMIT;\s*$/m;
  if (!begin.test(sql) || !commit.test(sql)) throw new Error('Migration must have an outer BEGIN/COMMIT.');
  return sql.replace(begin, '').replace(commit, '');
}

export async function runMigrations(
  client: ScriptExecutor, directory: string, containsSearch = true, log: (message: string) => void = console.log
) {
  await client.query('SELECT pg_advisory_lock($1)', [lockId]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.divyashilla_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.query('REVOKE ALL ON public.divyashilla_migrations FROM PUBLIC');
    const names = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    const applied = await client.query<{name: string; checksum: string}>('SELECT name, checksum FROM public.divyashilla_migrations');
    if (applied.rows.some(row => !names.includes(row.name))) throw new Error('Database has a migration missing from this code package.');
    if (applied.rows.length === 0) {
      const result = await client.query<{schema: string | null}>("SELECT to_regnamespace('divyashilla')::text AS schema");
      if (result.rows[0]?.schema) throw new Error('Existing DivyaShilla schema has no migration history. Stop and baseline it with a developer; do not drop data.');
    }
    for (const name of names) {
      const sql = await readFile(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.rows.find(row => row.name === name);
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration changed: ${name}. Create a new migration instead.`);
        log(`Already applied: ${name}`);
        continue;
      }
      if (name === '004_contains_search.sql' && !containsSearch) { log(`Deferred optional extension: ${name}`); continue; }
      await client.query('BEGIN');
      try {
        await client.exec(migrationBody(sql));
        await client.query('INSERT INTO public.divyashilla_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        log(`Applied: ${name}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock($1)', [lockId]); }
}
