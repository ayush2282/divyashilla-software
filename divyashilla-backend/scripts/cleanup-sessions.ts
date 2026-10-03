import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/database.js';
async function main() {
  const db = createDatabase(loadConfig());
  try {
    const result = await db.database.query(`DELETE FROM divyashilla.sessions
      WHERE expires_at < clock_timestamp() - interval '7 days'
      OR revoked_at < clock_timestamp() - interval '7 days'`);
    console.log(`Removed ${result.rowCount ?? 0} old sessions.`);
  } finally { await db.close(); }
}
main().catch(() => { console.error('Session cleanup failed.'); process.exitCode = 1; });
