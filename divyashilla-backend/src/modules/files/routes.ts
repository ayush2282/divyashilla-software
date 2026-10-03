import express,{ Router,type Request } from 'express';
import { pipeline } from 'node:stream/promises';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import type { PrivateStorage } from '../../storage/types.js';
import { idParamsSchema } from '../../shared/master-validation.js';
import { requireAuth,requireCsrf,requireRoles } from '../auth/middleware.js';
import { fileService,type FileActor } from './service.js';
import { decodedFilename,fileListSchema,MAX_FILE_BYTES,uploadMime,uploadSchema } from './validation.js';
const actor=(req:Request):FileActor=>({id:req.auth!.user.id,role:req.auth!.user.role,requestId:req.requestId});
export function fileRoutes(db:Database,config:Config,storage:PrivateStorage) {
  const router=Router(),service=fileService(db,storage);
  router.use(requireAuth(db,config),requireRoles('ADMIN','DELIVERY'));
  router.post('/',requireCsrf(config),async(req,_res,next)=>{
    // Authenticate, validate MIME/filename and authorize the owner before buffering bytes.
    uploadMime(req.get('Content-Type'));decodedFilename(req.get('X-File-Name'));
    await service.preflight(uploadSchema.parse(req.query),actor(req));next();
  },express.raw({type:()=>true,limit:MAX_FILE_BYTES}),async(req,res)=>{
    const row=await service.upload(uploadSchema.parse(req.query),req.body,uploadMime(req.get('Content-Type')),
      decodedFilename(req.get('X-File-Name')),actor(req));
    res.location('/api/v1/files/'+row.id).status(201).json({data:row});
  });
  router.get('/',async(req,res)=>res.json(await service.list(fileListSchema.parse(req.query),actor(req))));
  router.get('/:id',async(req,res)=>res.json({data:await service.get(idParamsSchema.parse(req.params).id,actor(req))}));
  router.get('/:id/download',async(req,res)=>{
    const file=await service.download(idParamsSchema.parse(req.params).id,actor(req));
    res.attachment(file.name).type(file.mime).set('Content-Length',file.size).set('X-Content-Type-Options','nosniff');
    // Headers are committed only after authorization, storage checks and required auditing.
    try {await pipeline(file.stream,res);}
    catch {console.error(JSON.stringify({event:'file_transfer_interrupted',requestId:req.requestId}));if (!res.destroyed) res.destroy();}
  });
  return router;
}
