import type { Database,SqlExecutor } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { writeActivity } from '../audit/activity-log.js';
import { checkSupplier,fail,ledgerRow,listLedger,lockSupplier,logLedger,postOnce,voidLedger,type Actor,type LedgerList,type LedgerRow } from '../../shared/ledger-records.js';
import { cents } from '../orders/validation.js';
import type { SupplierPayment,Allocation } from './validation.js';
async function withAllocations(tx:SqlExecutor,id:string) {
  const row=await ledgerRow(tx,'supplier_payments',id);
  const allocations=await tx.query(`SELECT a.*,amount::text AS amount FROM divyashilla.supplier_payment_allocations a
    WHERE supplier_payment_id=$1 ORDER BY order_id`,[id]);
  return {...row,allocations:allocations.rows};
}
async function allocate(tx:SqlExecutor,payment:LedgerRow,input:Allocation[],actor:Actor) {
  const current=(await tx.query<{order_id:string;amount:string}>(`SELECT order_id,amount::text FROM divyashilla.supplier_payment_allocations
    WHERE supplier_payment_id=$1`,[payment.id])).rows;
  if (input.some(row=>current.some(old=>old.order_id===row.order_id))) fail('ALLOCATION_EXISTS','An allocation already exists for this payment and order. Void and replace the payment to correct it.');
  const sum=[...current,...input].reduce((total,row)=>total+cents(row.amount),0n);
  if (sum>cents(payment.amount)) fail('ALLOCATION_EXCEEDS_PAYMENT','Total allocations cannot exceed the payment or refund amount.');
  for (const allocation of [...input].sort((a,b)=>a.order_id.localeCompare(b.order_id))) {
    const order=(await tx.query<{supplier_id:string|null;buying_price:string|null}>(
      'SELECT supplier_id,buying_price::text FROM divyashilla.orders WHERE id=$1 FOR UPDATE',[allocation.order_id])).rows[0];
    if (!order) throw new AppError(404,'ORDER_NOT_FOUND','Allocated order not found.');
    if (order.supplier_id!==payment.supplier_id || order.buying_price===null) fail('INVALID_ALLOCATION_ORDER','Allocate only to a priced order belonging to this supplier.');
    const row=(await tx.query<{id:string}>(`INSERT INTO divyashilla.supplier_payment_allocations(supplier_payment_id,order_id,supplier_id,amount,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,[payment.id,allocation.order_id,payment.supplier_id,allocation.amount,actor.id])).rows[0]!;
    await writeActivity(tx,{actorId:actor.id,action:'SUPPLIER_PAYMENT_ALLOCATED',entityType:'SUPPLIER_PAYMENT_ALLOCATION',entityId:row.id,
      after:{id:row.id,supplier_payment_id:payment.id,order_id:allocation.order_id,supplier_id:payment.supplier_id as string,amount:allocation.amount},requestId:actor.requestId});
  }
}
export function supplierPaymentService(db:Database) {
  return {
    list:(input:LedgerList)=>listLedger(db,'supplier_payments',input),
    get:(id:string)=>db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');return withAllocations(tx,id);
    }),
    async balance(id:string) {
      const row=(await db.query(`SELECT supplier_id,name,known_liability::text,unpriced_orders::text,net_paid::text,net_allocated::text,
        unallocated_net_advance::text,net_position::text,payable::text,credit::text FROM divyashilla.supplier_balances WHERE supplier_id=$1`,[id])).rows[0];
      if (!row) throw new AppError(404,'SUPPLIER_NOT_FOUND','Supplier not found.');return row;
    },
    add:(input:SupplierPayment,key:string,actor:Actor)=>postOnce(db,'SUPPLIER_PAYMENT_ADD',key,input,actor,async tx=>{
      const supplier=await lockSupplier(tx,input.supplier_id);
      if (input.direction==='PAYMENT' && !supplier.is_active) fail('SUPPLIER_INACTIVE','New payments require an active supplier; refunds are allowed.');
      const id=(await tx.query<{id:string}>(`INSERT INTO divyashilla.supplier_payments
        (supplier_id,amount,direction,payment_date,payment_method,note,paid_by,processed_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[input.supplier_id,input.amount,input.direction,input.payment_date,
        input.payment_method,input.note??null,input.direction==='PAYMENT'?actor.id:null,actor.id])).rows[0]!.id;
      const row=await ledgerRow(tx,'supplier_payments',id);
      await allocate(tx,row,input.allocations,actor);await checkSupplier(tx,input.supplier_id);
      await logLedger(tx,'supplier_payments',row,actor);return withAllocations(tx,id);
    }),
    allocate:(id:string,input:Allocation[],key:string,actor:Actor)=>postOnce(db,'SUPPLIER_ALLOCATE:'+id,key,input,actor,async tx=>{
      const old=await ledgerRow(tx,'supplier_payments',id);await lockSupplier(tx,old.supplier_id as string);
      const row=await ledgerRow(tx,'supplier_payments',id,true);
      if (row.status!=='POSTED') fail('PAYMENT_VOID','Voided payments cannot receive allocations.');
      await allocate(tx,row,input,actor);await checkSupplier(tx,row.supplier_id as string);return withAllocations(tx,id);
    }),
    async void(id:string,reason:string,actor:Actor) {await voidLedger(db,'supplier_payments',id,reason,actor);return withAllocations(db,id);}
  };
}
