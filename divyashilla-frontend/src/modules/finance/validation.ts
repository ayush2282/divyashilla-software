import { z } from 'zod';
import { money } from '../orders/validation';
import { reasonSchema } from '../masters/validation';
import type { LedgerKind } from './types';
export const cents=(v:string)=>{const [whole,fraction='']=v.split('.');return BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));};
export const decimal=(n:bigint)=>(n<0n?'-':'')+(n<0n?-n:n)/100n+'.'+((n<0n?-n:n)%100n).toString().padStart(2,'0');
export const positiveMoney=money.pipe(z.string().refine(v=>cents(v)>0n,'Amount must be greater than zero.'));
export const paymentMethods=['CASH','UPI','BANK_TRANSFER','OTHER'] as const;
export const receiptPurposes=['ADVANCE','INSTALLMENT','FINAL','OTHER'] as const;
const date=z.iso.date().refine(v=>!v.startsWith('0000-'),'Invalid year.');
const note=z.string().trim().max(2000,'Use at most 2000 characters.').refine(v=>!v.includes('\u0000'),'Invalid character.').nullable().transform(v=>v===''?null:v);
const fields={amount:positiveMoney,payment_date:date,payment_method:z.enum(paymentMethods),note};
export const allocationsSchema=z.array(z.object({order_id:z.string().uuid('Choose an order.'),amount:positiveMoney}).strict()).max(100,'Use at most 100 allocations.')
  .refine(rows=>new Set(rows.map(row=>row.order_id)).size===rows.length,'Choose each order only once.');
export const customerPaymentSchema=z.discriminatedUnion('direction',[
  z.object({...fields,order_id:z.string().uuid('Choose an order.'),direction:z.literal('RECEIPT'),purpose:z.enum(receiptPurposes)}).strict(),
  z.object({...fields,order_id:z.string().uuid('Choose an order.'),direction:z.literal('REFUND')}).strict()
]);
export const supplierPaymentSchema=z.object({...fields,supplier_id:z.string().uuid('Choose a supplier.'),direction:z.enum(['PAYMENT','REFUND']),allocations:allocationsSchema}).strict()
  .superRefine((v,ctx)=>{if(v.allocations.reduce((n,row)=>n+cents(row.amount),0n)>cents(v.amount))ctx.addIssue({code:'custom',path:['allocations'],message:'Allocations cannot exceed this payment or refund amount.'});});
export const expenseSchema=z.object({order_id:z.string().uuid('Choose an order.'),category:z.enum(['DELIVERY','OTHER']),amount:positiveMoney,expense_date:date,note}).strict();
export const allocationSchema=z.object({allocations:allocationsSchema.refine(rows=>rows.length>0,'Add at least one allocation.')}).strict();
export const voidSchema=z.object({reason:reasonSchema}).strict();
const integer=(max:number)=>z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
export function parseLedgerFilters(kind:LedgerKind,params:URLSearchParams) {
  if([...params.keys()].some(key=>params.getAll(key).length>1))return {success:false as const};
  const shared={page:integer(100000).default(1),limit:integer(100).default(20),sort_order:z.enum(['asc','desc']).default('desc'),status:z.enum(['POSTED','VOID','all']).default('POSTED'),date_from:date.optional(),date_to:date.optional(),order_id:z.string().uuid().optional()};
  const extra=kind==='customer-payments'?{direction:z.enum(['RECEIPT','REFUND']).optional()}:kind==='supplier-payments'?{supplier_id:z.string().uuid().optional(),direction:z.enum(['PAYMENT','REFUND']).optional()}:{category:z.enum(['DELIVERY','OTHER']).optional()};
  return z.object({...shared,...extra}).strict().refine(v=>!v.date_from||!v.date_to||v.date_from<=v.date_to,'From date must not follow to date.').safeParse(Object.fromEntries(params));
}
export const newContextSchema=z.object({order_id:z.string().uuid().optional(),supplier_id:z.string().uuid().optional()}).strict();
