import { useState,type FormEvent } from 'react';
import { Link,useNavigate,useParams } from 'react-router-dom';
import { useResource } from '../../api/useResource';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState,ErrorState,FormError,Loading } from '../../components/States';
import type { OrderDetail } from '../orders/types';
import { rupees } from '../dashboard/format';
import type { Allocation,LedgerRecord } from './types';
import { AllocationRows } from './AllocationRows';
import { allocationSchema,cents,decimal } from './validation';
import { SupplierBalancePanel } from './BalancePanels';
import { usePosting } from './usePosting';
function AllocationOrder({id}:{id:string}) {const resource=useResource<{data:OrderDetail}>('/orders/'+id);return <Link to={'/orders/'+id}>{resource.data?'#'+resource.data.data.order_number+' · '+resource.data.data.delivery_name:'View order '+id.slice(0,8)}</Link>;}
export function AllocationTable({rows}:{rows:Allocation[]}) {return !rows.length?<p className="muted">No saved allocations.</p>:<div className="table-wrap"><table className="records-table"><caption className="sr-only">Saved supplier payment allocations</caption><thead><tr><th scope="col">Order</th><th scope="col">Allocated amount</th></tr></thead><tbody>{rows.map(row=><tr key={row.order_id}><td className="primary-cell" data-label="Order"><AllocationOrder id={row.order_id}/></td><td data-label="Allocated amount">{rupees(row.amount)}</td></tr>)}</tbody></table></div>;}
export function SupplierAllocationPage() {
  const {id}=useParams(),resource=useResource<{data:LedgerRecord}>('/supplier-payments/'+id),row=resource.data?.data;
  return <><Link className="back-link" to={'/supplier-payments/'+id}>← Back to supplier payment</Link><PageHeader eyebrow="SUPPLIER PAYMENTS · ADMIN" title="Allocate to orders" description="Assign an existing payment or refund to orders. This does not record another money movement."/>{resource.loading?<Loading label="Loading payment allocations…"/>:resource.error?<ErrorState message={resource.error} retry={resource.reload}/>:row?.status==='VOID'?<EmptyState title="This record is void" description="Void records cannot receive new allocations."/>:row?<AllocateForm key={row.id} record={row}/>:null}</>;
}
function AllocateForm({record}:{record:LedgerRecord}) {
  const [rows,setRows]=useState<Allocation[]>([]),[error,setError]=useState<string|null>(null),navigate=useNavigate();
  const saved=record.allocations??[],remaining=cents(record.amount)-saved.reduce((n,row)=>n+cents(row.amount),0n);
  const posting=usePosting<{data:LedgerRecord}>('/supplier-payments/'+record.id+'/allocations',()=>navigate('/supplier-payments/'+record.id,{replace:true,state:{notice:'Order allocations saved.'}}));
  async function submit(e:FormEvent){e.preventDefault();if(posting.busy)return;if(posting.uncertain){await posting.submit(undefined);return;}setError(null);
    const parsed=allocationSchema.safeParse({allocations:rows.map(row=>({...row,amount:row.amount.trim()}))});
    if(!parsed.success){setError(parsed.error.issues.map(i=>i.message).join(' '));return;}
    if(parsed.data.allocations.some(row=>saved.some(old=>old.order_id===row.order_id))){setError('This payment already has an allocation for that order. Void and replace the payment to correct it.');return;}
    if(parsed.data.allocations.reduce((n,row)=>n+cents(row.amount),0n)>remaining){setError('New allocations exceed the unallocated amount on this record.');return;}
    await posting.submit(parsed.data);
  }
  return <><section className="panel ledger-detail"><h2>Existing allocations</h2><p>Record {record.id.slice(0,8)} · {record.direction==='REFUND'?'Refund from supplier':'Payment to supplier'} · {rupees(record.amount)}</p><AllocationTable rows={saved}/></section>{remaining<=0n?<EmptyState title="Fully allocated" description="The full amount has already been allocated. Allocations are retained as history; to correct them, void and replace the payment."/>:<form className="ledger-form" noValidate onSubmit={submit}><FormError message={posting.error??error}/>{posting.uncertain&&<div className="alert warning">The result is uncertain. Keep this page open and retry the same submission to check it without duplicating allocations.</div>}<fieldset disabled={posting.busy||posting.uncertain}><legend className="sr-only">New order allocations</legend><AllocationRows supplierId={record.supplier_id!} rows={rows} onChange={setRows} excluded={saved.map(row=>row.order_id)} remaining={decimal(remaining)}/></fieldset><div className="form-actions"><Link className={'button secondary '+(posting.busy?'disabled':'')} to={'/supplier-payments/'+record.id}>Back to payment</Link><button className="button primary" disabled={posting.busy}>{posting.busy?'Saving…':posting.uncertain?'Retry same submission':'Save allocations'}</button></div></form>}<SupplierBalancePanel supplierId={record.supplier_id!}/></>;
}
