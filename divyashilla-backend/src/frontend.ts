import { stat } from 'node:fs/promises';
import { resolve,parse } from 'node:path';
import express from 'express';
import type { Express } from 'express';

export async function validateFrontend(directory:string) {
  if(!directory) return;
  const root=resolve(directory);
  if(root===parse(root).root || !(await stat(resolve(root,'index.html')).catch(()=>null))?.isFile())
    throw new Error('FRONTEND_DIRECTORY must contain the built frontend index.html.');
}
export function mountFrontend(app:Express,directory:string) {
  if(!directory) return;
  const root=resolve(directory);
  const staticFiles=express.static(root,{index:false,dotfiles:'deny',redirect:false});
  app.use((req,res,next)=>{
    if(/^\/(api|health)(\/|$)/.test(req.path)){next();return;}
    staticFiles(req,res,next);
  });
  app.get('/{*path}',(req,res,next)=>{
    // Unknown API/health/assets must remain errors, never return HTML as data.
    if(/^\/(api|health|assets)(\/|$)/.test(req.path) || req.path.includes('.') || !req.accepts('html')) {next();return;}
    res.sendFile(resolve(root,'index.html'));
  });
}
