import { createHash } from 'node:crypto';
import type { Database,SqlExecutor } from '../db/database.js';
import { writeActivity } from '../modules/audit/activity-log.js';
import { AppError } from './errors.js';
import { lockFinancialWrites } from './financial-lock.js';
export type LedgerTable='customer_payments'|'supplier_payments'|'order_expenses';
export type SafeValue=string|number|boolean|null;
export interface Actor {id:string;requestId:string}
export interface LedgerRow {id:string;amount:string;status:'POSTED'|'VOID';[key:string]:unknown}
export const fail=(code:string,message:string):never=>{throw new AppError(409,code,message);};
export const entity=(table:LedgerTable)=>({customer_payments:'CUSTOMER_PAYMENT',supplier_payments:'SUPPLIER_PAYMENT',order_expenses:'ORDER_EXPENSE'})[table];
export async function ledgerRow(tx:SqlExecutor,table:LedgerTable,id:string,lock=false):Promise<LedgerRow> {
  const date=table==='order_expenses'?'expense_date':'payment_date';
  const result=await tx.query<LedgerRow>(`SELECT l.*,amount::text AS amount,${date}::text AS ${date}
    FROM divyashilla.${table} l WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id]);
  if (!result.rows[0]) throw new AppError(404,'LEDGER_NOT_FOUND','Payment or expense not found.');
  return result.rows[0];
}
export async function lockOrder(tx:SqlExecutor,id:string) {
  const row=(await tx.query<{id:string;order_status:string;supplier_id:string|null}>(
    'SELECT id,order_status,supplier_id FROM divyashilla.orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if (!row) throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');
  return row;
}
export async function lockSupplier(tx:SqlExecutor,id:string) {
  // Same lock ordering throughout the services: financial lock, order rows, supplier.
  await tx.query('SELECT id FROM divyashilla.orders WHERE supplier_id=$1 ORDER BY id FOR UPDATE',[id]);
  const row=(await tx.query<{id:string;is_active:boolean}>('SELECT id,is_active FROM divyashilla.suppliers WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if (!row) throw new AppError(404,'SUPPLIER_NOT_FOUND','Supplier not found.');
  return row;
}
export async function checkCustomer(tx:SqlExecutor,id:string) {
  const row=(await tx.query<{ok:boolean}>(`SELECT customer_net_received>=0 AND balance_amount>=0 AS ok
    FROM divyashilla.order_financials WHERE order_id=$1`,[id])).rows[0]!;
  if (!row.ok) fail('INVALID_CUSTOMER_BALANCE','Net receipts must stay between zero and selling price. Check receipts, refunds and voids.');
}
export async function checkSupplier(tx:SqlExecutor,id:string) {
  const supplier=(await tx.query<{ok:boolean}>(`SELECT net_paid>=0 AND net_paid<=known_liability AND unallocated_net_advance>=0 AS ok
    FROM divyashilla.supplier_balances WHERE supplier_id=$1`,[id])).rows[0]!;
  if (!supplier.ok) fail('INVALID_SUPPLIER_BALANCE','Payment exceeds known supplier costs, or refund/void exceeds available paid funds.');
  const orders=await tx.query(`SELECT order_id FROM divyashilla.order_financials WHERE supplier_id=$1
    AND (supplier_net_paid<0 OR (buying_price IS NULL AND supplier_net_paid<>0) OR supplier_net_paid>buying_price) LIMIT 1`,[id]);
  if (orders.rows.length) fail('INVALID_ALLOCATION_BALANCE','Allocated net payments must stay between zero and the order buying price.');
}
const auditFields=['id','order_id','supplier_id','amount','direction','purpose','category','payment_date','expense_date','payment_method',
  'note','status','received_by','paid_by','processed_by','created_by','void_reason','voided_by'];
export function auditLedger(row:LedgerRow):Record<string,SafeValue> {
  return Object.fromEntries(auditFields.filter(key=>key in row).map(key=>[key,row[key] as SafeValue]));
}
export async function logLedger(tx:SqlExecutor,table:LedgerTable,row:LedgerRow,actor:Actor,before?:LedgerRow,reason?:string) {
  await writeActivity(tx,{actorId:actor.id,action:entity(table)+(before?'_VOIDED':'_POSTED'),entityType:entity(table),entityId:row.id,
    ...(before?{before:auditLedger(before)}:{}),after:auditLedger(row),...(reason?{reason}:{}),requestId:actor.requestId});
}
function canonical(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
  return value;
}
export async function postOnce<T extends {id:string}>(db:Database,operation:string,key:string,input:unknown,actor:Actor,work:(tx:SqlExecutor)=>Promise<T>) {
  const hash=createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  return db.transaction(async tx=>{
    await lockFinancialWrites(tx);
    const previous=(await tx.query<{request_hash:string;result:T;expired:boolean}>(`SELECT request_hash,result,expires_at<=clock_timestamp() AS expired
      FROM divyashilla.idempotency_requests WHERE user_id=$1 AND operation=$2 AND key=$3 FOR UPDATE`,[actor.id,operation,key])).rows[0];
    if (previous) {
      if (previous.request_hash!==hash) fail('IDEMPOTENCY_CONFLICT','This key was used with different data.');
      if (previous.expired) fail('IDEMPOTENCY_EXPIRED','This key is expired. Check the original record before using a new key.');
      return {data:previous.result,replayed:true};
    }
    const data=await work(tx);
    await tx.query(`INSERT INTO divyashilla.idempotency_requests(user_id,operation,key,request_hash,resource_id,result,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp()+interval '7 days')`,[actor.id,operation,key,hash,data.id,JSON.stringify(data)]);
    return {data,replayed:false};
  });
}
export async function voidLedger(db:Database,table:LedgerTable,id:string,reason:string,actor:Actor) {
  return db.transaction(async tx=>{
    await lockFinancialWrites(tx);
    const old=await ledgerRow(tx,table,id);
    if (table==='supplier_payments') await lockSupplier(tx,old.supplier_id as string);
    else await lockOrder(tx,old.order_id as string);
    const locked=await ledgerRow(tx,table,id,true);
    if (locked.status==='VOID') return locked;
    await tx.query(`UPDATE divyashilla.${table} SET status='VOID',void_reason=$2,voided_at=clock_timestamp(),voided_by=$3 WHERE id=$1`,[id,reason,actor.id]);
    if (table==='customer_payments') await checkCustomer(tx,old.order_id as string);
    if (table==='supplier_payments') await checkSupplier(tx,old.supplier_id as string);
    const row=await ledgerRow(tx,table,id);
    await logLedger(tx,table,row,actor,locked,reason);
    return row;
  });
}
export interface LedgerList {page:number;limit:number;sort_order:'asc'|'desc';status:'POSTED'|'VOID'|'all';date_from?:string;date_to?:string;
  order_id?:string;supplier_id?:string;direction?:string;category?:string}
export async function listLedger(db:Database,table:LedgerTable,input:LedgerList) {
  const values:unknown[]=[],filters:string[]=[];
  const add=(column:string,op:string,value:unknown)=>{values.push(value);filters.push('l.'+column+op+'$'+values.length);};
  for (const key of ['order_id','supplier_id','direction','category'] as const) if (input[key]) {
    if (table==='supplier_payments' && key==='order_id') {
      values.push(input[key]);filters.push(`EXISTS(SELECT 1 FROM divyashilla.supplier_payment_allocations a WHERE a.supplier_payment_id=l.id AND a.order_id=$${values.length})`);
    } else add(key,'=',input[key]);
  }
  if (input.status!=='all') add('status','=',input.status);
  const date=table==='order_expenses'?'expense_date':'payment_date';
  if (input.date_from) add(date,'>=',input.date_from);if (input.date_to) add(date,'<=',input.date_to);
  const where=filters.length?'WHERE '+filters.join(' AND '):'';
  return db.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const total=Number((await tx.query<{n:string}>(`SELECT count(*)::text AS n FROM divyashilla.${table} l ${where}`,values)).rows[0]!.n);
    const rows=await tx.query<LedgerRow>(`SELECT l.*,amount::text AS amount,${date}::text AS ${date} FROM divyashilla.${table} l ${where}
      ORDER BY l.${date} ${input.sort_order},l.id ${input.sort_order} LIMIT $${values.length+1} OFFSET $${values.length+2}`,
      [...values,input.limit,(input.page-1)*input.limit]);
    return {data:rows.rows,meta:{page:input.page,limit:input.limit,total,total_pages:Math.ceil(total/input.limit)}};
  });
}
