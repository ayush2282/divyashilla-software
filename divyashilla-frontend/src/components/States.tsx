import { Icon } from './Icon';
export function Loading({label='Loading your workspace…'}:{label?:string}) {return <div className="state" role="status"><span className="spinner"/><p>{label}</p></div>;}
export function ErrorState({message,retry}:{message:string;retry?:()=>void}) {return <div className="state error-state" role="alert"><strong>We couldn’t load this</strong><p>{message}</p>{retry&&<button className="button secondary" onClick={retry}>Try again</button>}</div>;}
export function EmptyState({title,description,action}:{title:string;description:string;action?:React.ReactNode}) {return <div className="state"><span className="empty-icon"><Icon name="designs" size={26}/></span><h2>{title}</h2><p>{description}</p>{action}</div>;}
export function FormError({message}:{message:string|null}) {return message?<div className="alert error" role="alert">{message}</div>:null;}
