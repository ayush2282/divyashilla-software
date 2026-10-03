import { z } from 'zod';
import { masterConfigs,type MasterKind } from './config';
const required=(max:number)=>z.string().trim().min(1,'This field is required.').max(max,`Use at most ${max} characters.`).refine(v=>!/[\u0000-\u001f\u007f]/.test(v),'Control characters are not allowed.');
const nullable=(max:number)=>z.string().trim().max(max,`Use at most ${max} characters.`).refine(v=>!v.includes('\u0000'),'Invalid character.').transform(v=>v||null);
export const phoneSchema=z.string().trim().max(40).transform(v=>v.replace(/[\s()-]/g,''))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/,'Use 7–15 digits, optionally starting with +.'));
const contact={name:required(120),phone:phoneSchema,address:nullable(1000),notes:nullable(2000)};
const schemas={customers:z.object({...contact,city:required(100)}).strict(),suppliers:z.object({...contact,city:nullable(100)}).strict(),
  designs:z.object({design_number:required(40),design_name:required(120),size:required(80),material:required(80),notes:nullable(2000)}).strict()};
export function validateMaster(kind:MasterKind,input:Record<string,string>) {return schemas[kind].safeParse(input);}
export const reasonSchema=required(500);
const integer=(max:number)=>z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
export function validateList(kind:MasterKind,params:URLSearchParams) {
  const fields:Record<string,z.ZodType>={page:integer(100000).default(1),limit:integer(100).default(20),
    q:z.string().trim().max(100).refine(v=>!v.includes('\u0000')).default(''),status:z.enum(['active','inactive','all']).default('active'),
    sort_by:z.enum(masterConfigs[kind].sorts.map(s=>s.key) as [string,...string[]]).default('created_at'),sort_order:z.enum(['asc','desc']).default('desc')};
  for(const filter of masterConfigs[kind].filters) fields[filter.key]=filter.key==='phone'?phoneSchema.optional():required(filter.max).optional();
  const result=z.object(fields).strict().safeParse(Object.fromEntries(params));
  const duplicate=[...params.keys()].some(key=>params.getAll(key).length>1);
  return duplicate?{success:false as const}:result;
}
