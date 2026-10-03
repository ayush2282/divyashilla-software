import { useEffect,useRef,useState,type FormEvent } from 'react';
import type { MasterRecord } from '../../api/types';
import { api,errorMessage } from '../../api/client';
import { FormError } from '../../components/States';
import { Icon } from '../../components/Icon';
import { masterConfigs,text,type MasterKind } from './config';
import { reasonSchema } from './validation';
export function StatusDialog({kind,record,onClose,onSaved}:{kind:MasterKind;record:MasterRecord;onClose:()=>void;onSaved:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const action=record.is_active?'Deactivate':'Reactivate',config=masterConfigs[kind];
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function submit(e:FormEvent) {
    e.preventDefault();if(busy)return;const parsed=reasonSchema.safeParse(reason);
    if(!parsed.success){setError(parsed.error.issues[0]!.message);return;}
    setBusy(true);setError(null);
    try {await api('/'+kind+'/'+record.id+'/'+(record.is_active?'deactivate':'reactivate'),{method:'POST',body:{reason:parsed.data}});onSaved();onClose();}
    catch(problem){setError(errorMessage(problem));setBusy(false);}
  }
  return <dialog ref={dialog} className="status-dialog" aria-labelledby="status-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><button className="icon-button dialog-close" aria-label="Close confirmation" disabled={busy} onClick={onClose}><Icon name="close"/></button><span className="eyebrow">RECORD STATUS</span><h2 id="status-title">{action} {config.singular}?</h2><p>{text(record[config.nameKey])}</p><p className="muted">{record.is_active?'This record will be hidden from active lists. Existing business history stays available.':'This record will appear in active lists again.'}</p><form noValidate onSubmit={submit}><FormError message={error}/><label className="field" htmlFor="reason">Reason <span className="required">*</span><textarea id="reason" autoFocus value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} rows={3} required/></label><div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className={'button '+(record.is_active?'danger':'primary')} disabled={busy}>{busy?'Saving…':action}</button></div></form></dialog>;
}
