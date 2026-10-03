import { Router } from 'express';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { idParamsSchema, statusChangeSchema } from '../../shared/master-validation.js';
import { supplierService } from './service.js';
import { createSupplierSchema, supplierListSchema, updateSupplierSchema } from './validation.js';

export function supplierRoutes(db: Database,config: Config) {
  const router = Router(),service = supplierService(db),csrf = requireCsrf(config);
  router.use(requireAuth(db,config),requireRoles('ADMIN'));
  router.get('/',async (req,res) => res.json(await service.list(supplierListSchema.parse(req.query))));
  router.get('/:id',async (req,res) => res.json({data:await service.get(idParamsSchema.parse(req.params).id)}));
  router.post('/',csrf,async (req,res) => {
    const row = await service.create(createSupplierSchema.parse(req.body),{id:req.auth!.user.id,requestId:req.requestId});
    res.location('/api/v1/suppliers/'+row.id).status(201).json({data:row});
  });
  router.patch('/:id',csrf,async (req,res) => res.json({data:await service.update(idParamsSchema.parse(req.params).id,
    updateSupplierSchema.parse(req.body),{id:req.auth!.user.id,requestId:req.requestId})}));
  router.post('/:id/deactivate',csrf,async (req,res) => res.json({data:await service.setActive(idParamsSchema.parse(req.params).id,false,
    statusChangeSchema.parse(req.body).reason,{id:req.auth!.user.id,requestId:req.requestId})}));
  router.delete('/:id',csrf,async (req,res) => res.json({data:await service.setActive(idParamsSchema.parse(req.params).id,false,
    statusChangeSchema.parse(req.body).reason,{id:req.auth!.user.id,requestId:req.requestId})}));
  router.post('/:id/reactivate',csrf,async (req,res) => res.json({data:await service.setActive(idParamsSchema.parse(req.params).id,true,
    statusChangeSchema.parse(req.body).reason,{id:req.auth!.user.id,requestId:req.requestId})}));
  return router;
}
