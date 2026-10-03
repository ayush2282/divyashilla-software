import { useEffect,useState,type FormEvent } from 'react';
import { Link,useNavigate,useParams } from 'react-router-dom';
import { api,errorMessage } from '../../api/client';
import type { MasterRecord } from '../../api/types';
import { useResource } from '../../api/useResource';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState,FormError,Loading } from '../../components/States';
import { masterConfigs,text,type MasterKind } from './config';
import { validateMaster } from './validation';
export function MasterFormPage({kind,editing=false}:{kind:MasterKind;editing?:boolean}) {
  const {id}=useParams(),config=masterConfigs[kind],resource=useResource<{data:MasterRecord}>(editing?'/'+kind+'/'+id:null);
  return <><Link className="back-link" to={'/'+kind}>← Back to {config.title.toLowerCase()}</Link><PageHeader eyebrow="BUSINESS RECORDS" title={(editing?'Edit ':'Add ')+config.singular} description="Keep the details clear and up to date."/>{editing&&resource.loading?<Loading label="Loading record…"/>:editing&&resource.error?<ErrorState message={resource.error} retry={resource.reload}/>:!editing||resource.data?<RecordForm key={kind+'-'+(resource.data?.data.id??'new')} kind={kind} record={resource.data?.data}/>:null}</>;
}
function RecordForm({kind,record}:{kind:MasterKind;record?:MasterRecord}) {
  const config=masterConfigs[kind],navigate=useNavigate(),[values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(config.fields.map(f=>[f.key,text(record?.[f.key])]))),[errors,setErrors]=useState<Record<string,string>>({}),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  // Protect unsaved work when the tab is closed/reloaded. The Cancel link remains explicit.
  const initial=JSON.stringify(Object.fromEntries(config.fields.map(f=>[f.key,text(record?.[f.key])]))),dirty=initial!==JSON.stringify(values);
  useEffect(()=>{if(!dirty)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
  async function submit(e:FormEvent) {
    e.preventDefault();if(busy)return;setError(null);setErrors({});const parsed=validateMaster(kind,values);
    if(!parsed.success) {setErrors(Object.fromEntries(parsed.error.issues.map(issue=>[String(issue.path[0]),issue.message])));return;}
    setBusy(true);
    try {await api<{data:MasterRecord}>('/'+kind+(record?'/'+record.id:''),{method:record?'PATCH':'POST',body:parsed.data});navigate('/'+kind,{replace:true,state:{notice:config.singular.charAt(0).toUpperCase()+config.singular.slice(1)+(record?' updated.':' created.')}});}
    catch(problem){setError(errorMessage(problem));setBusy(false);}
  }
  return <form className="panel master-form" noValidate onSubmit={submit}><div className="section-heading"><h2>{kind==='designs'?'Design details':'Contact details'}</h2><span>* Required fields</span></div><FormError message={error}/>{record&&!record.is_active&&<div className="alert warning">This record is inactive. Editing details does not reactivate it.</div>}<fieldset disabled={busy}><legend className="sr-only">{config.singular} details</legend><div className="form-grid">{config.fields.map(field=><label className={'field '+(field.type==='textarea'?'wide':'')} key={field.key} htmlFor={field.key}>{field.label}{field.required&&<span className="required">*</span>}{field.type==='textarea'?<textarea aria-label={field.label} id={field.key} value={values[field.key]??''} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))} maxLength={field.max} rows={field.key==='address'?3:4} aria-invalid={Boolean(errors[field.key])} aria-describedby={errors[field.key]?field.key+'-error':undefined}/>:<input aria-label={field.label} id={field.key} type={field.type==='tel'?'tel':'text'} value={values[field.key]??''} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))} maxLength={field.max} required={field.required} autoComplete={field.key==='phone'?'tel':field.key==='city'?'address-level2':field.key==='name'?'name':'off'} aria-invalid={Boolean(errors[field.key])} aria-describedby={errors[field.key]?field.key+'-error':undefined}/>} {field.key==='size'&&<small className="field-hint">For example: 3.15 feet. Keep your original size description.</small>}{errors[field.key]&&<small className="field-error" id={field.key+'-error'}>{errors[field.key]}</small>}</label>)}</div></fieldset><div className="form-actions"><Link className={'button secondary '+(busy?'disabled':'')} aria-disabled={busy} tabIndex={busy?-1:0} to={'/'+kind} onClick={e=>{if(busy)e.preventDefault();}}>Cancel</Link><button className="button primary" disabled={busy}>{busy?'Saving…':record?'Save changes':'Create '+config.singular}</button></div></form>;
}
