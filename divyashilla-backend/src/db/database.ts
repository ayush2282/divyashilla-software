import pg from 'pg';
import type { Config } from '../config.js';

export interface SqlResult<T> { rows: T[]; rowCount: number | null }
export interface SqlExecutor {
  query<T extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<T>>;
}
export interface ScriptExecutor extends SqlExecutor { exec(text: string): Promise<void> }
export interface Database extends SqlExecutor {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export function executor(client: pg.PoolClient): ScriptExecutor {
  return {
    query: async <T extends object>(text: string, values?: unknown[]) => {
      const result = await client.query<T>(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    // SQL migrations contain multiple statements; use the simple query protocol.
    exec: async text => { await client.query(text); }
  };
}

export function createDatabase(config: Config, migrationOwner = false) {
  const pool = new pg.Pool({
    connectionString: migrationOwner ? (config.MIGRATION_DATABASE_URL || config.DATABASE_URL) : config.DATABASE_URL,
    ssl: config.PG_SSL ? { rejectUnauthorized: true } : false,
    max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, application_name: 'divyashilla-phase1'
  });
  pool.on('error', () => console.error('An idle database connection failed.'));
  const database: Database = {
    query: async <T extends object>(text: string, values?: unknown[]) => {
      const result = await pool.query<T>(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    transaction: async work => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(executor(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
  };
  return { database, pool, close: () => pool.end() };
}
