import { z } from 'zod';
import { listFields, nullableText, requiredText } from './master-validation.js';
import { money,cents } from '../modules/orders/validation.js';
export const positiveMoney=money.refine(value=>cents(value)>0n,'Amount must be greater than zero.');
export const paymentMethod=z.enum(['CASH','UPI','BANK_TRANSFER','OTHER']);
export const idempotencyKey=z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/,'Supply a unique Idempotency-Key (8–200 safe characters).');
export const voidSchema=z.object({reason:requiredText(500)}).strict();
export const paymentFields={amount:positiveMoney,payment_date:z.iso.date(),payment_method:paymentMethod,note:nullableText(2000).optional()};
export const ledgerListFields={page:listFields.page,limit:listFields.limit,sort_order:listFields.sort_order,
  status:z.enum(['POSTED','VOID','all']).default('POSTED'),date_from:z.iso.date().optional(),date_to:z.iso.date().optional()};
export function validDateRange(value:{date_from?:string;date_to?:string}) {
  return !value.date_from || !value.date_to || value.date_from<=value.date_to;
}
