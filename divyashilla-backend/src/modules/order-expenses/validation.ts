import { z } from 'zod';
import { ledgerListFields,positiveMoney,validDateRange } from '../../shared/ledger-validation.js';
import { nullableText } from '../../shared/master-validation.js';
export const expenseSchema=z.object({order_id:z.string().uuid(),category:z.enum(['DELIVERY','OTHER']),amount:positiveMoney,
  expense_date:z.iso.date(),note:nullableText(2000).optional()}).strict();
export const expenseList=z.object({...ledgerListFields,order_id:z.string().uuid().optional(),category:z.enum(['DELIVERY','OTHER']).optional()})
  .strict().refine(validDateRange,'Invalid date range.');
export type Expense=z.infer<typeof expenseSchema>;
