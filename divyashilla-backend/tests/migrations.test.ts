import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, join } from 'node:path';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runMigrations } from '../src/db/migrations.js';
import { fixture } from './helpers.js';

test('original migrations apply and rerunning does not recreate tables',async () => {
  const f = await fixture();
  try {
    await runMigrations(f.migrationClient,resolve('migrations'),true,() => {});
    const rows = await f.db.query<{count: string}>('SELECT count(*)::text AS count FROM public.divyashilla_migrations');
    assert.equal(rows.rows[0]!.count,'4');
    const sequence = await f.db.query<{last_value: string; is_called: boolean}>('SELECT last_value::text,is_called FROM divyashilla.orders_order_number_seq');
    assert.equal(sequence.rows[0]!.last_value,'1001');
    assert.equal(sequence.rows[0]!.is_called,false);
  } finally {await f.pg.close();}
});

test('modified migration is rejected and failed new migration leaves no partial table/history',async () => {
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(),'divyashilla-migrations-'));
  try {
    await cp(resolve('migrations'),directory,{recursive:true});
    const path = join(directory,'001_foundation.sql');
    const original = await readFile(path,'utf8');
    await writeFile(path,original+'\n-- changed\n');
    await assert.rejects(runMigrations(f.migrationClient,directory,true,() => {}),/Applied migration changed/);
    await writeFile(path,original);
    await writeFile(join(directory,'005_failure.sql'),'BEGIN;\nCREATE TABLE divyashilla.must_rollback(id integer);\nSELECT missing_column FROM divyashilla.users;\nCOMMIT;\n');
    await assert.rejects(runMigrations(f.migrationClient,directory,true,() => {}));
    const table = await f.db.query<{name: string | null}>("SELECT to_regclass('divyashilla.must_rollback')::text AS name");
    assert.equal(table.rows[0]!.name,null);
    const records = await f.db.query<{count: string}>('SELECT count(*)::text AS count FROM public.divyashilla_migrations');
    assert.equal(records.rows[0]!.count,'4');
  } finally {await f.pg.close();await rm(directory,{recursive:true,force:true});}
});
