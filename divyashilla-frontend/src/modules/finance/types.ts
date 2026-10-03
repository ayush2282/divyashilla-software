import type { PageMeta } from '../../api/types';
export type LedgerKind='customer-payments'|'supplier-payments'|'order-expenses';
export interface Allocation {order_id:string;amount:string}
export interface LedgerRecord {
  id:string;amount:string;status:'POSTED'|'VOID';order_id?:string;supplier_id?:string;
  direction?:'RECEIPT'|'PAYMENT'|'REFUND';purpose?:string|null;category?:'DELIVERY'|'OTHER';
  payment_date?:string;expense_date?:string;payment_method?:string;note:string|null;
  created_at:string;updated_at:string;voided_at:string|null;void_reason:string|null;
  allocations?:Allocation[];
}
export interface LedgerPage {data:LedgerRecord[];meta:PageMeta}
export interface CustomerBalance {order_id:string;order_number:string;selling_price:string;advance_amount:string;advance_receipts_recorded:string;customer_net_received:string;balance_amount:string}
export interface SupplierBalance {supplier_id:string;name:string;known_liability:string;unpriced_orders:string;net_paid:string;net_allocated:string;unallocated_net_advance:string;net_position:string;payable:string;credit:string}
export const ledgerConfig:Record<LedgerKind,{title:string;singular:string;add:string}>={
  'customer-payments':{title:'Customer payments',singular:'Customer payment',add:'Add customer payment'},
  'supplier-payments':{title:'Supplier payments',singular:'Supplier payment',add:'Add supplier payment'},
  'order-expenses':{title:'Order expenses',singular:'Order expense',add:'Add order expense'}
};
export const label=(value:string)=>value==='UPI'?'UPI':value.toLowerCase().split('_').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' ');
