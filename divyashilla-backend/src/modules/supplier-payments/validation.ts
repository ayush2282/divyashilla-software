import { z } from 'zod';
import { ledgerListFields,paymentFields,positiveMoney,validDateRange } from '../../shared/ledger-validation.js';
export const allocations=z.array(z.object({order_id:z.string().uuid(),amount:positiveMoney}).strict()).max(100)
  .refine(rows=>new Set(rows.map(row=>row.order_id)).size===rows.length,'Allocate to each order only once per request.');
export const supplierPaymentSchema=z.object({...paymentFields,supplier_id:z.string().uuid(),direction:z.enum(['PAYMENT','REFUND']),
  allocations:allocations.default([])}).strict();
export const allocationSchema=z.object({allocations:allocations.refine(rows=>rows.length>0,'Supply an allocation.')}).strict();
export const supplierPaymentList=z.object({...ledgerListFields,supplier_id:z.string().uuid().optional(),order_id:z.string().uuid().optional(),direction:z.enum(['PAYMENT','REFUND']).optional()})
  .strict().refine(validDateRange,'Invalid date range.');
export type SupplierPayment=z.infer<typeof supplierPaymentSchema>;
export type Allocation=z.infer<typeof allocations>[number];
