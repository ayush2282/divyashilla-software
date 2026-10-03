import { useState,type FormEvent,type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { FormError } from '../components/States';
import { PasswordField } from '../components/PasswordField';
import { Icon } from '../components/Icon';
import { home,useAuth } from './AuthProvider';
import { loginSchema,passwordSchema } from './validation';
function AuthCard({children}:{children:ReactNode}) {return <main className="auth-shell"><div className="auth-brand"><span className="brand-mark"><Icon name="designs" size={29}/></span><span>DivyaShilla<small>BUSINESS WORKSPACE</small></span></div><div className="auth-card">{children}</div><p className="auth-footer">Handcrafted stone. Thoughtfully managed.</p></main>;}
export function LoginPage() {
  const auth=useAuth(),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[fields,setFields]=useState<Record<string,string>>({});
  if(auth.session) return <Navigate to={home(auth.session)} replace/>;
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy) return;
    const parsed=loginSchema.safeParse({username,password});setFields({});setError(null);
    if(!parsed.success) {setFields(Object.fromEntries(parsed.error.issues.map(i=>[String(i.path[0]),i.message])));return;}
    setBusy(true);try {await auth.login(parsed.data.username,parsed.data.password);setPassword('');} catch(problem) {setError(errorMessage(problem));} finally {setBusy(false);}
  }
  return <AuthCard><span className="eyebrow">WELCOME BACK</span><h1>Sign in to your workspace</h1><p className="muted">Manage your business with a little more clarity.</p><form onSubmit={submit} noValidate><FormError message={error}/><label className="field" htmlFor="username">Username<input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e=>setUsername(e.target.value)} maxLength={64} required aria-invalid={Boolean(fields.username)} aria-describedby={fields.username?'username-error':undefined}/>{fields.username&&<small id="username-error" className="field-error">{fields.username}</small>}</label><PasswordField id="password" label="Password" value={password} onChange={setPassword} error={fields.password}/><button className="button primary full" disabled={busy}>{busy?'Signing in…':<>Sign in <Icon name="arrow" size={17}/></>}</button></form><p className="auth-note"><Icon name="lock" size={15}/> Private access for your team</p></AuthCard>;
}
export function ChangePasswordPage() {
  const auth=useAuth(),[values,setValues]=useState({currentPassword:'',newPassword:'',confirmPassword:''}),[fields,setFields]=useState<Record<string,string>>({}),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  if(!auth.session) return <Navigate to="/login" replace/>;
  if(!auth.session.user.mustChangePassword) return <Navigate to={home(auth.session)} replace/>;
  async function submit(e:FormEvent) {
    e.preventDefault();if(busy) return;setError(null);setFields({});const parsed=passwordSchema.safeParse(values);
    if(!parsed.success) {setFields(Object.fromEntries(parsed.error.issues.map(i=>[String(i.path[0]),i.message])));return;}
    setBusy(true);try {await auth.changePassword(parsed.data.currentPassword,parsed.data.newPassword);setValues({currentPassword:'',newPassword:'',confirmPassword:''});}catch(problem){setError(errorMessage(problem));}finally{setBusy(false);}
  }
  return <AuthCard><span className="eyebrow">SECURE YOUR ACCOUNT</span><h1>Choose your own password</h1><p className="muted">Replace your temporary password before opening the workspace. Use 12–128 characters.</p><form noValidate onSubmit={submit}><FormError message={error}/>{(['currentPassword','newPassword','confirmPassword'] as const).map(key=><PasswordField key={key} id={key} label={key==='currentPassword'?'Current password':key==='newPassword'?'New password':'Confirm new password'} value={values[key]} onChange={v=>setValues(old=>({...old,[key]:v}))} autoComplete={key==='currentPassword'?'current-password':'new-password'} error={fields[key]}/>)}<button className="button primary full" disabled={busy}>{busy?'Saving…':'Save password'}</button><button className="button text full" type="button" disabled={busy} onClick={()=>{setBusy(true);void auth.logout().catch(e=>setError(errorMessage(e))).finally(()=>setBusy(false));}}>Sign out</button></form></AuthCard>;
}
