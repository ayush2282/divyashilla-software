import { useEffect,useRef,useState,type FormEvent } from 'react';
import { api,errorMessage } from '../../api/client';
import { FormError } from '../../components/States';
import { ledgerConfig,type LedgerKind,type LedgerRecord } from './types';
import { rupees } from '../dashboard/format';
import { voidSchema } from './validation';
export function VoidDialog({kind,record,onClose,onSaved}:{kind:LedgerKind;record:LedgerRecord;onClose:()=>void;onSaved:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[reason,setReason]=useState(''),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function submit(e:FormEvent){e.preventDefault();if(busy)return;const parsed=voidSchema.safeParse({reason});setError(null);if(!parsed.success){setError(parsed.error.issues[0]!.message);return;}setBusy(true);
    try{await api('/'+kind+'/'+record.id+'/void',{method:'POST',body:parsed.data});onSaved();onClose();}catch(problem){setError(errorMessage(problem));setBusy(false);}}
  return <dialog ref={dialog} className="status-dialog" aria-labelledby="void-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><span className="eyebrow">FINANCIAL CORRECTION</span><h2 id="void-title">Void {ledgerConfig[kind].singular.toLowerCase()}?</h2><p>{rupees(record.amount)} · Record {record.id.slice(0,8)}</p><p className="field-hint">Void corrects a recorded entry; it does not return money. The record and reason remain in history. Balances must remain valid after the correction.</p><form noValidate onSubmit={submit}><FormError message={error}/><label className="field"><span>Void reason *</span><textarea aria-label="Void reason" autoFocus rows={3} maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Keep record</button><button className="button danger" disabled={busy}>{busy?'Voiding…':'Confirm void'}</button></div></form></dialog>;
}
