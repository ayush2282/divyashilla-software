import { Router } from 'express';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { idParamsSchema } from '../../shared/master-validation.js';
import { idempotencyKey,voidSchema } from '../../shared/ledger-validation.js';
import { requireAuth,requireCsrf,requireRoles } from '../auth/middleware.js';
import { supplierPaymentService } from './service.js';
import { supplierPaymentSchema,supplierPaymentList,allocationSchema } from './validation.js';
export function supplierPaymentRoutes(db:Database,config:Config) {
  const router=Router(),service=supplierPaymentService(db),csrf=requireCsrf(config);
  router.use(requireAuth(db,config),requireRoles('ADMIN'));
  router.get('/suppliers/:id/balance',async(req,res)=>res.json({data:await service.balance(idParamsSchema.parse(req.params).id)}));
  router.post('/:id/allocations',csrf,async(req,res)=>{
    const result=await service.allocate(idParamsSchema.parse(req.params).id,allocationSchema.parse(req.body).allocations,
      idempotencyKey.parse(req.get('Idempotency-Key')),{id:req.auth!.user.id,requestId:req.requestId});
    res.set('Idempotency-Replayed',String(result.replayed)).json({data:result.data});
  });
  router.get('/',async(req,res)=>res.json(await service.list(supplierPaymentList.parse(req.query))));
  router.get('/:id',async(req,res)=>res.json({data:await service.get(idParamsSchema.parse(req.params).id)}));
  router.post('/',csrf,async(req,res)=>{
    const result=await service.add(supplierPaymentSchema.parse(req.body),idempotencyKey.parse(req.get('Idempotency-Key')),
      {id:req.auth!.user.id,requestId:req.requestId});
    res.set('Idempotency-Replayed',String(result.replayed)).location('/api/v1/supplier-payments/'+result.data.id).status(201).json({data:result.data});
  });
  router.post('/:id/void',csrf,async(req,res)=>res.json({data:await service.void(idParamsSchema.parse(req.params).id,
    voidSchema.parse(req.body).reason,{id:req.auth!.user.id,requestId:req.requestId})}));
  return router;
}
