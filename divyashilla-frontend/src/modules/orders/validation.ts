import { z } from 'zod';
import { phoneSchema,reasonSchema } from '../masters/validation';
import { orderStatuses } from './types';
const required=(max:number)=>z.string().trim().min(1,'This field is required.').max(max).refine(v=>!/[\u0000-\u001f\u007f]/.test(v),'Control characters are not allowed.');
const nullable=(max:number)=>z.string().trim().max(max).refine(v=>!v.includes('\u0000'),'Invalid character.').nullable().transform(v=>v===''?null:v);
export const money=z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/,'Use a positive decimal amount with at most 2 decimal places (zero is allowed).')
  .transform(v=>{const [whole,fraction='']=v.split('.');return whole+'.'+fraction.padEnd(2,'0');});
const cents=(v:string)=>BigInt(v.replace('.',''));
const date=z.iso.date().refine(v=>!v.startsWith('0000-'),'Invalid year.');
const orderFields={customer_id:z.string().uuid('Choose a customer.'),design_id:z.string().uuid('Choose a design.'),supplier_id:z.string().uuid().nullable(),
  order_date:date,expected_delivery_date:date.nullable(),selling_price:money,buying_price:money.nullable(),advance_amount:money,additional_work:nullable(5000),
  delivery_name:required(200).optional(),delivery_phone:phoneSchema.optional(),delivery_city:required(150).optional(),delivery_address:nullable(2000).optional()};
export const createOrderSchema=z.object(orderFields).strict().superRefine((v,ctx)=>{
  if(cents(v.advance_amount)>cents(v.selling_price))ctx.addIssue({code:'custom',path:['advance_amount'],message:'Agreed advance cannot exceed selling price.'});
  if(v.expected_delivery_date&&v.expected_delivery_date<v.order_date)ctx.addIssue({code:'custom',path:['expected_delivery_date'],message:'Expected delivery cannot precede the order date.'});
});
// The form validates the complete merged record first; PATCH sends changed fields only.
export const updateOrderSchema=z.object(orderFields).partial().extend({version:z.number().int().min(1).max(2147483646)}).strict()
  .refine(v=>Object.keys(v).length>1,'No changes to save.');
const integer=(max:number)=>z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
export const orderListSchema=z.object({q:z.string().trim().max(100).refine(v=>!v.includes('\u0000')).default(''),
  page:integer(100000).default(1),limit:integer(100).default(20),sort_by:z.enum(['order_number','order_date','expected_delivery_date','created_at']).default('order_number'),sort_order:z.enum(['asc','desc']).default('desc'),
  order_status:z.enum(orderStatuses).optional(),order_number:z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n).optional(),
  customer_id:z.string().uuid().optional(),design_id:z.string().uuid().optional(),supplier_id:z.string().uuid().optional(),date_from:date.optional(),date_to:date.optional()
}).strict().refine(v=>!v.date_from||!v.date_to||v.date_from<=v.date_to,'Invalid date range.');
export function parseOrderFilters(params:URLSearchParams) {
  if([...params.keys()].some(key=>params.getAll(key).length>1))return {success:false as const};
  return orderListSchema.safeParse(Object.fromEntries(params));
}
export const statusSchema=z.object({version:z.number().int().min(1).max(2147483646),order_status:z.enum(orderStatuses),reason:reasonSchema}).strict();
export function indiaToday() {const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=(key:string)=>p.find(part=>part.type===key)!.value;return get('year')+'-'+get('month')+'-'+get('day');}
