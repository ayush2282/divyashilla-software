import { Router } from 'express';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { idParamsSchema } from '../../shared/master-validation.js';
import { requireAuth,requireCsrf,requireRoles } from '../auth/middleware.js';
import { deliveryService,type DeliveryActor } from './service.js';
import { assigneeListSchema,assignDeliverySchema,completeDeliverySchema,deliveryListSchema,driverUpdateSchema,issueDeliverySchema,sendDeliverySchema } from './validation.js';
import type { Request } from 'express';
const actor=(req:Request):DeliveryActor=>({id:req.auth!.user.id,role:req.auth!.user.role,requestId:req.requestId});
export function deliveryRoutes(db:Database,config:Config) {
  const router=Router(),service=deliveryService(db),csrf=requireCsrf(config);
  router.use(requireAuth(db,config),requireRoles('ADMIN','DELIVERY'));
  router.get('/',async(req,res)=>res.json(await service.list(deliveryListSchema.parse(req.query),actor(req))));
  router.get('/assignees',requireRoles('ADMIN'),async(req,res)=>res.json(await service.assignees(assigneeListSchema.parse(req.query),actor(req))));
  router.get('/:id',async(req,res)=>res.json({data:await service.get(idParamsSchema.parse(req.params).id,actor(req))}));
  router.post('/:id/assign',requireRoles('ADMIN'),csrf,async(req,res)=>res.json({data:await service.assign(idParamsSchema.parse(req.params).id,assignDeliverySchema.parse(req.body),actor(req))}));
  router.post('/:id/send',csrf,async(req,res)=>res.json({data:await service.send(idParamsSchema.parse(req.params).id,sendDeliverySchema.parse(req.body),actor(req))}));
  router.patch('/:id/driver',csrf,async(req,res)=>res.json({data:await service.updateDriver(idParamsSchema.parse(req.params).id,driverUpdateSchema.parse(req.body),actor(req))}));
  router.post('/:id/deliver',csrf,async(req,res)=>res.json({data:await service.complete(idParamsSchema.parse(req.params).id,completeDeliverySchema.parse(req.body),actor(req))}));
  router.post('/:id/issue',csrf,async(req,res)=>res.json({data:await service.issue(idParamsSchema.parse(req.params).id,issueDeliverySchema.parse(req.body),actor(req))}));
  return router;
}
