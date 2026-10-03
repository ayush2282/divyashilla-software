import { useEffect, useState } from 'react';
import { api, errorMessage } from './client';

// Cancel old reads on navigation/filter changes; never show stale records after errors.
export function useResource<T>(path:string|null) {
  const [state,setState]=useState<{path:string|null;data?:T;loading:boolean;error?:string}>({path,loading:true});
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    if(path===null) {setState({path,loading:false});return;}
    setState({path,loading:true});
    api<T>(path,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted) setState({path,data,loading:false});})
      .catch(error=>{if(!controller.signal.aborted) setState({path,loading:false,error:errorMessage(error)});});
    return ()=>controller.abort();
  },[path,version]);
  // A render can occur before the effect clears an old path's response.
  return {...(state.path===path?state:{path,loading:true}),reload:()=>setVersion(value=>value+1)};
}
