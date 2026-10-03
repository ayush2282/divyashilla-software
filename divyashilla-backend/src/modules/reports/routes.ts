import { Router } from 'express';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { requireAuth, requireRoles } from '../auth/middleware.js';
import { reportService } from './service.js';
import { parseReport, reportKinds } from './validation.js';

export function reportRoutes(db:Database,config:Config) {
  const router=Router(),service=reportService(db);
  // Authorization runs before validation/queries for every report and CSV endpoint.
  router.use(requireAuth(db,config),requireRoles('ADMIN'));
  for(const kind of reportKinds) {
    router.get('/'+kind,async(req,res)=>res.json(await service.read(kind,parseReport(kind,req.query))));
    router.get('/'+kind+'/export',async(req,res)=>{
      const csv=await service.export(kind,parseReport(kind,req.query,true),{id:req.auth!.user.id,requestId:req.requestId});
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="divyashilla-${kind}.csv"`);
      res.send(csv);
    });
  }
  return router;
}
