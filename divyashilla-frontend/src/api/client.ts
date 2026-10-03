export class ApiError extends Error {
  constructor(public status:number,public code:string,message:string,public requestId?:string,public fields:string[]=[]) {super(message);this.name='ApiError';}
}
let csrfToken:string|null=null;
export function setCsrfToken(value:string|null) {csrfToken=value;}
export const SESSION_INVALID='divyashilla:session-invalid';
export const SESSION_REFRESH='divyashilla:session-refresh';
interface RequestOptions {method?:'GET'|'POST'|'PATCH'|'DELETE';body?:unknown;signal?:AbortSignal;idempotencyKey?:string}
async function request(path:string,method:string,headers:Record<string,string>,body?:BodyInit,signal?:AbortSignal) {
  if(method!=='GET'&&path!=='/auth/login') {if(!csrfToken)throw new ApiError(401,'LOGIN_REQUIRED','Please sign in again.');headers['X-CSRF-Token']=csrfToken;}
  let response:Response;
  try {response=await fetch('/api/v1'+path,{method,headers,credentials:'include',cache:'no-store',body,signal});}
  catch(error){if(typeof error==='object'&&error!==null&&'name' in error&&error.name==='AbortError')throw error;throw new ApiError(0,'NETWORK_ERROR','Cannot reach the server. Check your connection and try again.');}
  if(!response.ok){const data=await response.json().catch(()=>undefined);
    if(response.status===401&&path!=='/auth/login'){setCsrfToken(null);window.dispatchEvent(new Event(SESSION_INVALID));}
    if(response.status===403&&['CSRF_INVALID','FORBIDDEN','PASSWORD_CHANGE_REQUIRED'].includes(data?.error?.code))window.dispatchEvent(new Event(SESSION_REFRESH));
    throw new ApiError(response.status,data?.error?.code??'API_ERROR',data?.error?.message??'The request could not be completed.',response.headers.get('X-Request-Id')??undefined,Array.isArray(data?.error?.fields)?data.error.fields.filter((v:unknown)=>typeof v==='string').slice(0,100):[]);
  }
  return response;
}
export async function api<T>(path:string,options:RequestOptions={}):Promise<T> {
  const headers:Record<string,string>={Accept:'application/json'};
  if(options.body!==undefined)headers['Content-Type']='application/json';
  if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
  const response=await request(path,options.method??'GET',headers,options.body===undefined?undefined:JSON.stringify(options.body),options.signal);
  if(response.status===204)return undefined as T;
  const data=await response.json().catch(()=>undefined);if(data===undefined)throw new ApiError(502,'INVALID_RESPONSE','The server returned an unexpected response.');return data as T;
}
export async function uploadFile<T>(path:string,file:File,mime:string):Promise<T> {
  const response=await request(path,'POST',{Accept:'application/json','Content-Type':mime,'X-File-Name':encodeURIComponent(file.name.trim())},file);
  const data=await response.json().catch(()=>undefined);if(data===undefined)throw new ApiError(502,'INVALID_RESPONSE','Upload response is uncertain. Check the file list before uploading again.');return data as T;
}
export async function downloadFile(id:string,signal?:AbortSignal):Promise<Blob> {
  const response=await request('/files/'+encodeURIComponent(id)+'/download','GET',{Accept:'image/jpeg, image/png, image/webp, application/pdf'},undefined,signal);
  const blob=await response.blob();if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(blob.type)||blob.size<1||blob.size>10485760)throw new ApiError(502,'INVALID_FILE_RESPONSE','The server returned an unexpected file.');return blob;
}
export function errorMessage(error:unknown):string {if(error instanceof ApiError&&error.fields.length)return error.message+' Fields: '+error.fields.map(field=>field.replace(/_/g,' ').replace(/\.(\d+)\./g,(_,n:string)=>' '+(Number(n)+1)+' ')).join(', ')+'.';return error instanceof Error?error.message:'Something went wrong. Please try again.';}
