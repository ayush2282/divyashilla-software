import { Router } from 'express';
import type { Database } from '../../db/database.js';

export function healthRoutes(db: Database) {
  const router = Router();
  router.get('/live',(_req,res) => res.json({status:'ok'}));
  router.get('/ready',async (_req,res) => {
    try {
      const result = await db.query<{count: string}>(`SELECT count(*)::text AS count FROM public.divyashilla_migrations
        WHERE name IN ('001_foundation.sql','002_tables.sql','003_guards_indexes_views.sql')`);
      const tables = await db.query<{ready: boolean}>(`SELECT
        to_regclass('divyashilla.users') IS NOT NULL AND to_regclass('divyashilla.sessions') IS NOT NULL
        AND to_regclass('divyashilla.activity_logs') IS NOT NULL AS ready`);
      if (result.rows[0]?.count !== '3' || !tables.rows[0]?.ready) throw new Error('Not migrated');
      res.json({status:'ready'});
    } catch { res.status(503).json({status:'not_ready'}); }
  });
  return router;
}
