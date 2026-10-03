import { z } from 'zod';
import { listFields, requiredText } from '../../shared/master-validation.js';
import { orderStatus } from '../orders/validation.js';

// PostgreSQL has no year zero. ISO validation also checks leap days/calendar dates.
const date = z.iso.date().refine(value => !value.startsWith('0000-'),'Invalid year.');
const dates = {date_from:date.optional(),date_to:date.optional()};
const filters = {...dates,order_status:orderStatus.optional(),city:requiredText(150).optional(),
  supplier_id:z.string().uuid().optional(),design_id:z.string().uuid().optional()};
const deliveryStatus = z.enum(['READY_FOR_DELIVERY','SENT','DELIVERED','ISSUE']);
export const reportKinds = ['dashboard','orders','profit','customer-dues','suppliers','deliveries'] as const;
export type ReportKind = typeof reportKinds[number];
export interface ReportInput {
  date_from?:string;date_to?:string;order_status?:z.infer<typeof orderStatus>;city?:string;
  supplier_id?:string;design_id?:string;delivery_status?:z.infer<typeof deliveryStatus>;page?:number;limit?:number;
}
const rangeValid = (value:{date_from?:string;date_to?:string}) =>
  !value.date_from || !value.date_to || value.date_from<=value.date_to;
const pagination={page:listFields.page,limit:listFields.limit};
const supplierFilters={...dates,supplier_id:filters.supplier_id};
const deliveryFilters={...filters,delivery_status:deliveryStatus.optional()};
const schema = {
  dashboard:z.object(dates).strict().refine(rangeValid,'Invalid date range.'),
  orders:z.object({...filters,...pagination}).strict().refine(rangeValid,'Invalid date range.'),
  suppliers:z.object({...supplierFilters,...pagination}).strict().refine(rangeValid,'Invalid date range.'),
  deliveries:z.object({...deliveryFilters,...pagination}).strict().refine(rangeValid,'Invalid date range.'),
  ordersExport:z.object(filters).strict().refine(rangeValid,'Invalid date range.'),
  suppliersExport:z.object(supplierFilters).strict().refine(rangeValid,'Invalid date range.'),
  deliveriesExport:z.object(deliveryFilters).strict().refine(rangeValid,'Invalid date range.')
};
export function parseReport(kind:ReportKind,query:unknown,exporting=false):ReportInput {
  if(kind==='dashboard') return schema.dashboard.parse(query);
  if(kind==='suppliers') return (exporting ? schema.suppliersExport : schema.suppliers).parse(query);
  if(kind==='deliveries') return (exporting ? schema.deliveriesExport : schema.deliveries).parse(query);
  return (exporting ? schema.ordersExport : schema.orders).parse(query);
}
