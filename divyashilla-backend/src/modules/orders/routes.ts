import { Router } from 'express';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { idParamsSchema } from '../../shared/master-validation.js';
import { requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { orderService } from './service.js';
import { createOrderSchema, updateOrderSchema, orderListSchema, orderStatusSchema } from './validation.js';

export function orderRoutes(db:Database,config:Config) {
  const router=Router(),service=orderService(db),csrf=requireCsrf(config);
  router.use(requireAuth(db,config),requireRoles('ADMIN'));
  router.get('/',async(req,res)=>res.json(await service.list(orderListSchema.parse(req.query))));
  router.get('/:id',async(req,res)=>res.json({data:await service.get(idParamsSchema.parse(req.params).id)}));
  router.post('/',csrf,async(req,res)=>{
    const row=await service.create(createOrderSchema.parse(req.body),{id:req.auth!.user.id,requestId:req.requestId});
    res.location('/api/v1/orders/'+row.id).status(201).json({data:row});
  });
  router.patch('/:id',csrf,async(req,res)=>res.json({data:await service.update(idParamsSchema.parse(req.params).id,
    updateOrderSchema.parse(req.body),{id:req.auth!.user.id,requestId:req.requestId})}));
  router.post('/:id/status',csrf,async(req,res)=>res.json({data:await service.changeStatus(idParamsSchema.parse(req.params).id,
    orderStatusSchema.parse(req.body),{id:req.auth!.user.id,requestId:req.requestId})}));
  return router;
}
