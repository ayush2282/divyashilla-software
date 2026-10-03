import { z } from 'zod';
import { phoneSchema,reasonSchema } from '../masters/validation';
import { deliveryStatuses } from './types';
const version=z.number().int().min(1).max(2147483646),date=z.iso.date().refine(v=>!v.startsWith('0000-'));
const drivers={driver_number:phoneSchema,driver_or_bus_name:z.string().trim().min(1,'Enter a driver or bus name.').max(200).refine(v=>!/[\u0000-\u001f\u007f]/.test(v)),bus_number:z.string().trim().max(100).refine(v=>!/[\u0000-\u001f\u007f]/.test(v)).nullable().transform(v=>v===''?null:v)};
export const driverSchema=z.object({version,...drivers}).strict();
export const completeSchema=z.object({version}).strict();
export const issueSchema=z.object({version,reason:reasonSchema}).strict();
export const assignmentSchema=z.object({version,assigned_delivery_user_id:z.string().uuid().nullable(),reason:reasonSchema}).strict();
const integer=(max:number)=>z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
export function parseDeliveryFilters(params:URLSearchParams,admin:boolean) {
  if([...params.keys()].some(k=>params.getAll(k).length>1))return {success:false as const};
  const base={q:z.string().trim().max(100).refine(v=>!v.includes('\u0000')).optional(),page:integer(100000).default(1),limit:integer(100).default(20),sort_order:z.enum(['asc','desc']).default('asc'),sort_by:z.enum(['order_number','expected_delivery_date','delivery_updated_at']).default('expected_delivery_date'),delivery_status:z.enum(deliveryStatuses).optional(),expected_from:date.optional(),expected_to:date.optional()};
  return z.object({...base,...(admin?{assigned_delivery_user_id:z.string().uuid().optional()}:{})}).strict().refine(v=>!v.expected_from||!v.expected_to||v.expected_from<=v.expected_to).safeParse(Object.fromEntries(params));
}
