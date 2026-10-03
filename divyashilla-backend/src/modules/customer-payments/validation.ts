import { z } from 'zod';
import { ledgerListFields,paymentFields,validDateRange } from '../../shared/ledger-validation.js';
export const customerPaymentSchema=z.discriminatedUnion('direction',[
  z.object({...paymentFields,order_id:z.string().uuid(),direction:z.literal('RECEIPT'),purpose:z.enum(['ADVANCE','INSTALLMENT','FINAL','OTHER'])}).strict(),
  z.object({...paymentFields,order_id:z.string().uuid(),direction:z.literal('REFUND')}).strict()
]);
export const customerPaymentList=z.object({...ledgerListFields,order_id:z.string().uuid().optional(),direction:z.enum(['RECEIPT','REFUND']).optional()})
  .strict().refine(validDateRange,'Invalid date range.');
export type CustomerPayment=z.infer<typeof customerPaymentSchema>;
