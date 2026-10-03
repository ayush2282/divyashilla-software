import { useState } from 'react';
export function PasswordField({id,label,value,onChange,autoComplete='current-password',error}:{id:string;label:string;value:string;onChange:(value:string)=>void;autoComplete?:string;error?:string}) {
  const [visible,setVisible]=useState(false);
  return <div className="field"><label htmlFor={id}>{label}</label><span className="password-input"><input id={id} type={visible?'text':'password'} autoComplete={autoComplete} value={value} onChange={e=>onChange(e.target.value)} maxLength={128} required aria-invalid={Boolean(error)} aria-describedby={error?id+'-error':undefined}/><button type="button" onClick={()=>setVisible(v=>!v)} aria-label={(visible?'Hide':'Show')+' '+label.toLowerCase()}>{visible?'Hide':'Show'}</button></span>{error&&<small id={id+'-error'} className="field-error">{error}</small>}</div>;
}
