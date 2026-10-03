import 'dotenv/config';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { configuredStorage } from './storage/configured.js';
import { validateFrontend } from './frontend.js';
import { createApp } from './app.js';

async function main() {
  const config = loadConfig();
  await validateFrontend(config.FRONTEND_DIRECTORY);
  const storage=configuredStorage(config);
  try {await storage.initialize();} catch {throw new Error('Cannot initialize private storage. Check storage settings, private container, identity permissions and network access.');}
  const db = createDatabase(config);
  try { await db.database.query('SELECT 1'); }
  catch { await db.close(); throw new Error('Cannot connect to PostgreSQL. Check database settings, TLS and network access.'); }
  const app = createApp(db.database,config,storage);
  const server = app.listen(config.PORT,config.HOST,() => console.log(`DivyaShilla backend listening on port ${config.PORT}.`));
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1),10000).unref();
    server.close(() => { void db.close().finally(() => { clearTimeout(timeout); process.exit(0); }); });
  };
  server.on('error',() => { console.error('HTTP server failed. Check HOST/PORT.'); shutdown(); });
  process.once('SIGINT',shutdown);
  process.once('SIGTERM',shutdown);
}
main().catch(error => {
  // Startup errors here are our own secret-free configuration messages.
  console.error(error instanceof Error ? error.message : 'Startup failed.');
  process.exitCode = 1;
});
