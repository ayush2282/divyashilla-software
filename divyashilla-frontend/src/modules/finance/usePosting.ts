import { useEffect,useRef,useState } from 'react';
import { api,ApiError,errorMessage } from '../../api/client';
// Retain the exact request and key when the server may have committed a write.
// Retrying is explicit; changed data is never sent with a previously used key.
export function usePosting<T>(path:string,onSaved:(result:T)=>void) {
  const attempt=useRef<{key:string;body:unknown}|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{if(!uncertain)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[uncertain]);
  async function submit(body:unknown) {
    if(busy)return;const current=attempt.current??{key:crypto.randomUUID(),body};attempt.current=current;setBusy(true);setError(null);
    try {const result=await api<T>(path,{method:'POST',body:current.body,idempotencyKey:current.key});attempt.current=null;setUncertain(false);onSaved(result);}
    catch(problem){setError(errorMessage(problem));const unknown=!(problem instanceof ApiError)||problem.status===0||problem.status>=500||problem.code==='IDEMPOTENCY_EXPIRED'||problem.code==='IDEMPOTENCY_CONFLICT';
      setUncertain(unknown);if(!unknown)attempt.current=null;}
    finally {setBusy(false);}
  }
  return {submit,busy,uncertain,error};
}
