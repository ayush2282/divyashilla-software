import { useEffect,useRef,useState,type FormEvent } from 'react';
import { api,ApiError,errorMessage } from '../../api/client';
import { FormError } from '../../components/States';
import { Icon } from '../../components/Icon';
import { statusLabel,type OrderDetail,type OrderStatus } from './types';
import { statusSchema } from './validation';
export function OrderStatusDialog({order,target,onClose,onSaved,onReload}:{order:OrderDetail;target:OrderStatus;onClose:()=>void;onSaved:()=>void;onReload:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[conflict,setConflict]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function submit(e:FormEvent){e.preventDefault();if(busy||conflict)return;setError(null);const parsed=statusSchema.safeParse({version:order.version,order_status:target,reason});
    if(!parsed.success){setError(parsed.error.issues[0]!.message);return;}setBusy(true);
    try{await api('/orders/'+order.id+'/status',{method:'POST',body:parsed.data});onSaved();onClose();}
    catch(problem){setError(errorMessage(problem));setConflict(problem instanceof ApiError&&problem.code==='VERSION_CONFLICT');setBusy(false);}}
  return <dialog ref={dialog} className="status-dialog" aria-labelledby="order-status-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><button className="icon-button dialog-close" type="button" aria-label="Close status dialog" disabled={busy} onClick={onClose}><Icon name="close"/></button><span className="eyebrow">ORDER #{order.order_number}</span><h2 id="order-status-title">{target==='CANCELLED'?'Cancel this order?':'Mark as '+statusLabel[target]+'?'}</h2><p className="muted">{statusLabel[order.order_status]} → {statusLabel[target]}</p>{target==='IN_WORK'&&<p className="field-hint">Supplier and buying price must be recorded before work starts.</p>}{target==='DELIVERED'&&<div className="alert warning">The linked delivery must already be Sent with valid driver details before you can mark this order as Delivered.</div>}{target==='CANCELLED'&&<p className="field-hint">Cancellation closes the order. Posted payments, supplier liabilities and expenses are not automatically reversed.</p>}<form noValidate onSubmit={submit}><FormError message={error}/>{conflict&&<button type="button" className="button secondary" onClick={()=>{onClose();onReload();}}>Reload latest order</button>}<label className="field">Reason *<textarea aria-label="Status change reason" value={reason} onChange={e=>setReason(e.target.value)} rows={3} maxLength={500} autoFocus/></label><div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Keep current status</button><button className={'button '+(target==='CANCELLED'?'danger':'primary')} disabled={busy||conflict}>{busy?'Saving…':'Confirm status change'}</button></div></form></dialog>;
}
