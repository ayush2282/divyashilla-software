import { z } from 'zod';
import { listFields, nullableText, phoneSchema, requiredText } from '../../shared/master-validation.js';

export const orderStatus = z.enum(['NEW','IN_WORK','READY_FOR_DELIVERY','DELIVERED','CANCELLED']);
// Decimal strings avoid floating-point rounding; PostgreSQL NUMERIC stores the value.
export const money = z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/)
  .transform(value => { const [whole, fraction = ''] = value.split('.'); return whole+'.'+fraction.padEnd(2,'0'); });
export const cents = (value: string) => BigInt(value.replace('.',''));
const fields = {
  customer_id:z.string().uuid(),design_id:z.string().uuid(),supplier_id:z.string().uuid().nullable(),
  order_date:z.iso.date(),expected_delivery_date:z.iso.date().nullable(),
  additional_work:nullableText(5000),buying_price:money.nullable(),selling_price:money,advance_amount:money,
  delivery_name:requiredText(200),delivery_phone:phoneSchema,delivery_city:requiredText(150),delivery_address:nullableText(2000)
};
export const createOrderSchema = z.object(fields).partial().required({customer_id:true,design_id:true,selling_price:true}).strict();
export const updateOrderSchema = z.object(fields).partial().extend({version:z.number().int().min(1).max(2147483646)}).strict()
  .refine(value => Object.keys(value).length > 1,'Supply at least one changed field.');
export const orderStatusSchema = z.object({version:z.number().int().min(1).max(2147483646),
  order_status:orderStatus,reason:requiredText(500)}).strict();
export const orderListSchema = z.object({page:listFields.page,limit:listFields.limit,q:listFields.q,sort_order:listFields.sort_order,
  sort_by:z.enum(['order_number','order_date','expected_delivery_date','created_at']).default('order_number'),
  order_status:orderStatus.optional(),order_number:z.string().regex(/^[1-9][0-9]{0,18}$/)
    .refine(value => BigInt(value) <= 9223372036854775807n).optional(),
  customer_id:z.string().uuid().optional(),design_id:z.string().uuid().optional(),supplier_id:z.string().uuid().optional(),
  date_from:z.iso.date().optional(),date_to:z.iso.date().optional()
}).strict().refine(value => !value.date_from || !value.date_to || value.date_from <= value.date_to,'Invalid date range.');
export type CreateOrder = z.infer<typeof createOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;
export type StatusChange = z.infer<typeof orderStatusSchema>;
export type OrderList = z.infer<typeof orderListSchema>;
