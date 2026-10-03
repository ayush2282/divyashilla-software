import type { SqlExecutor } from '../db/database.js';

// This small business serializes financial writes across ALL backend processes.
// Order price/link edits take the same transaction-scoped lock before row locks.
// Reads stay concurrent. PostgreSQL releases the lock on commit or rollback.
export async function lockFinancialWrites(tx:SqlExecutor) {
  await tx.query('SELECT pg_advisory_xact_lock($1)',[7744001]);
}
