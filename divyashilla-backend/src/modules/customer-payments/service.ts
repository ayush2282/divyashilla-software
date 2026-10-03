import type { Database } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { checkCustomer,fail,ledgerRow,listLedger,lockOrder,logLedger,postOnce,voidLedger,type Actor,type LedgerList } from '../../shared/ledger-records.js';
import type { CustomerPayment } from './validation.js';
export function customerPaymentService(db:Database) {
  return {
    list:(input:LedgerList)=>listLedger(db,'customer_payments',input),
    get:(id:string)=>ledgerRow(db,'customer_payments',id),
    async balance(id:string) {
      const row=(await db.query(`SELECT order_id,order_number::text,selling_price::text,advance_amount::text,
        advance_receipts_recorded::text,customer_net_received::text,balance_amount::text
        FROM divyashilla.order_financials WHERE order_id=$1`,[id])).rows[0];
      if (!row) throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');return row;
    },
    add:(input:CustomerPayment,key:string,actor:Actor)=>postOnce(db,'CUSTOMER_PAYMENT_ADD',key,input,actor,async tx=>{
      const order=await lockOrder(tx,input.order_id);
      if (input.direction==='RECEIPT' && order.order_status==='CANCELLED') fail('ORDER_CANCELLED','Cancelled orders can be refunded but cannot receive new receipts.');
      const id=(await tx.query<{id:string}>(`INSERT INTO divyashilla.customer_payments
        (order_id,amount,direction,purpose,payment_date,payment_method,note,received_by,processed_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[input.order_id,input.amount,input.direction,
        input.direction==='RECEIPT'?input.purpose:null,input.payment_date,input.payment_method,input.note??null,
        input.direction==='RECEIPT'?actor.id:null,actor.id])).rows[0]!.id;
      await checkCustomer(tx,input.order_id);const row=await ledgerRow(tx,'customer_payments',id);
      await logLedger(tx,'customer_payments',row,actor);return row;
    }),
    void:(id:string,reason:string,actor:Actor)=>voidLedger(db,'customer_payments',id,reason,actor)
  };
}
