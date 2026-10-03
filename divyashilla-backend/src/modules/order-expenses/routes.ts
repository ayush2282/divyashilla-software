import { Router } from 'express';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { idParamsSchema } from '../../shared/master-validation.js';
import { idempotencyKey,voidSchema } from '../../shared/ledger-validation.js';
import { requireAuth,requireCsrf,requireRoles } from '../auth/middleware.js';
import { expenseService } from './service.js';
import { expenseSchema,expenseList } from './validation.js';
export function expenseRoutes(db:Database,config:Config) {
  const router=Router(),service=expenseService(db),csrf=requireCsrf(config);
  router.use(requireAuth(db,config),requireRoles('ADMIN'));
  router.get('/',async(req,res)=>res.json(await service.list(expenseList.parse(req.query))));
  router.get('/:id',async(req,res)=>res.json({data:await service.get(idParamsSchema.parse(req.params).id)}));
  router.post('/',csrf,async(req,res)=>{
    const result=await service.add(expenseSchema.parse(req.body),idempotencyKey.parse(req.get('Idempotency-Key')),
      {id:req.auth!.user.id,requestId:req.requestId});
    res.set('Idempotency-Replayed',String(result.replayed)).location('/api/v1/order-expenses/'+result.data.id).status(201).json({data:result.data});
  });
  router.post('/:id/void',csrf,async(req,res)=>res.json({data:await service.void(idParamsSchema.parse(req.params).id,
    voidSchema.parse(req.body).reason,{id:req.auth!.user.id,requestId:req.requestId})}));
  return router;
}
