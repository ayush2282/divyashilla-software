import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { api,errorMessage,SESSION_INVALID,SESSION_REFRESH,setCsrfToken } from '../api/client';
import type { Session } from '../api/types';
interface AuthState {session:Session|null;loading:boolean;error:string|null;refresh:()=>Promise<void>;
  login:(username:string,password:string)=>Promise<void>;logout:()=>Promise<void>;
  changePassword:(currentPassword:string,newPassword:string)=>Promise<void>}
const AuthContext=createContext<AuthState|null>(null);
export function home(session:Session) {return session.user.mustChangePassword?'/change-password':session.user.role==='ADMIN'?'/dashboard':'/workspace';}
export function AuthProvider({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const generation=useRef(0),channel=useRef<BroadcastChannel|null>(null);
  const clear=useCallback(()=>{generation.current++;setCsrfToken(null);setSession(null);setLoading(false);setError(null);},[]);
  const accept=useCallback((value:Session)=>{setCsrfToken(value.csrfToken);setSession(value);setError(null);setLoading(false);},[]);
  const refresh=useCallback(async()=>{
    const current=++generation.current;
    try {const value=await api<Session>('/auth/me');if(current===generation.current) accept(value);}
    catch(problem) {if(current===generation.current) {setError(errorMessage(problem));setLoading(false);}}
  },[accept]);
  useEffect(()=>{
    const onRefresh=()=>{void refresh();};
    window.addEventListener(SESSION_INVALID,clear);window.addEventListener(SESSION_REFRESH,onRefresh);
    window.addEventListener('focus',onRefresh);
    if(typeof BroadcastChannel!=='undefined') {
      channel.current=new BroadcastChannel('divyashilla-session');
      channel.current.onmessage=()=>{void refresh();};
    }
    void refresh();
    return ()=>{generation.current++;window.removeEventListener(SESSION_INVALID,clear);window.removeEventListener(SESSION_REFRESH,onRefresh);
      window.removeEventListener('focus',onRefresh);channel.current?.close();channel.current=null;};
  },[clear,refresh]);
  useEffect(()=>{
    if(!session) return;
    const interval=window.setInterval(()=>{void refresh();},60000);
    const timeout=window.setTimeout(clear,Math.max(0,new Date(session.expiresAt).getTime()-Date.now()));
    return ()=>{clearInterval(interval);clearTimeout(timeout);};
  },[session,clear,refresh]);
  async function login(username:string,password:string) {
    generation.current++;accept(await api<Session>('/auth/login',{method:'POST',body:{username,password}}));
    channel.current?.postMessage('changed');
  }
  async function logout() {
    await api<void>('/auth/logout',{method:'POST'});clear();channel.current?.postMessage('changed');
  }
  async function changePassword(currentPassword:string,newPassword:string) {
    generation.current++;accept(await api<Session>('/auth/change-password',{method:'POST',body:{currentPassword,newPassword}}));
    channel.current?.postMessage('changed');
  }
  return <AuthContext.Provider value={{session,loading,error,refresh,login,logout,changePassword}}>{children}</AuthContext.Provider>;
}
export function useAuth() {const context=useContext(AuthContext);if(!context) throw new Error('AuthProvider is missing.');return context;}
