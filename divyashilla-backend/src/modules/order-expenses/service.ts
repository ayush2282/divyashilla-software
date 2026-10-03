import type { Database } from '../../db/database.js';
import { ledgerRow,listLedger,lockOrder,logLedger,postOnce,voidLedger,type Actor,type LedgerList } from '../../shared/ledger-records.js';
import type { Expense } from './validation.js';
export function expenseService(db:Database) {
  return {
    list:(input:LedgerList)=>listLedger(db,'order_expenses',input),get:(id:string)=>ledgerRow(db,'order_expenses',id),
    add:(input:Expense,key:string,actor:Actor)=>postOnce(db,'ORDER_EXPENSE_ADD',key,input,actor,async tx=>{
      await lockOrder(tx,input.order_id);
      const id=(await tx.query<{id:string}>(`INSERT INTO divyashilla.order_expenses(order_id,category,amount,expense_date,note,created_by)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,[input.order_id,input.category,input.amount,input.expense_date,input.note??null,actor.id])).rows[0]!.id;
      const row=await ledgerRow(tx,'order_expenses',id);await logLedger(tx,'order_expenses',row,actor);return row;
    }),
    void:(id:string,reason:string,actor:Actor)=>voidLedger(db,'order_expenses',id,reason,actor)
  };
}
