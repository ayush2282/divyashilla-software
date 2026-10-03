import 'dotenv/config';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createDatabase, executor } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations.js';

async function main() {
  const config = loadConfig();
  const db = createDatabase(config,true);
  try {
    const client = await db.pool.connect();
    try { await runMigrations(executor(client),resolve('migrations'),config.ENABLE_CONTAINS_SEARCH); }
    finally { client.release(); }
  } finally { await db.close(); }
}
main().catch(error => {
  const known = error instanceof Error && ['Existing DivyaShilla','Applied migration changed','Database has a migration'].some(prefix => error.message.startsWith(prefix));
  console.error(known ? error.message : 'Migration failed. Check connection, owner permissions and extension availability. No failed migration was committed.');
  process.exitCode = 1;
});
