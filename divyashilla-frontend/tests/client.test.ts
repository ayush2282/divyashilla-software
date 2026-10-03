import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { api,ApiError,setCsrfToken,SESSION_INVALID,SESSION_REFRESH } from '../src/api/client';
const fetcher=vi.fn<typeof fetch>();
beforeEach(()=>{vi.stubGlobal('fetch',fetcher);setCsrfToken(null);fetcher.mockReset();});
afterEach(()=>vi.unstubAllGlobals());
it('always includes backend cookies and disables browser caching',async()=>{
  fetcher.mockResolvedValue(Response.json({data:[]}));await api('/customers');
  expect(fetcher).toHaveBeenCalledWith('/api/v1/customers',expect.objectContaining({credentials:'include',cache:'no-store',method:'GET'}));
});
it('uses memory-only CSRF on writes and accepts empty logout responses',async()=>{
  setCsrfToken('test-csrf');fetcher.mockResolvedValue(new Response(null,{status:204}));await api('/auth/logout',{method:'POST'});
  expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({'X-CSRF-Token':'test-csrf'});
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});
it('login works without CSRF and serializes JSON',async()=>{
  fetcher.mockResolvedValue(Response.json({user:{}}));await api('/auth/login',{method:'POST',body:{username:'ayush',password:'test'}});
  const options=fetcher.mock.calls[0]![1]!;expect(options.body).toBe('{"username":"ayush","password":"test"}');
  expect(options.headers).not.toHaveProperty('X-CSRF-Token');
});
it('blocks protected writes when no session token is available',async()=>{
  await expect(api('/customers',{method:'POST',body:{}})).rejects.toMatchObject({status:401});expect(fetcher).not.toHaveBeenCalled();
});
it('expires the session on a protected 401 but not a bad login',async()=>{
  const listener=vi.fn();window.addEventListener(SESSION_INVALID,listener);
  fetcher.mockResolvedValue(Response.json({error:{code:'SESSION_INVALID',message:'Please sign in again.'}},{status:401}));
  await expect(api('/customers')).rejects.toBeInstanceOf(ApiError);expect(listener).toHaveBeenCalledOnce();
  await expect(api('/auth/login',{method:'POST',body:{}})).rejects.toMatchObject({status:401});expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener(SESSION_INVALID,listener);
});
it('requests role/CSRF refresh without retrying a financial or master write automatically',async()=>{
  setCsrfToken('old');const listener=vi.fn();window.addEventListener(SESSION_REFRESH,listener);
  fetcher.mockResolvedValue(Response.json({error:{code:'CSRF_INVALID',message:'Refresh your session and retry.'}},{status:403}));
  await expect(api('/customers',{method:'POST',body:{}})).rejects.toMatchObject({code:'CSRF_INVALID'});
  expect(listener).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();window.removeEventListener(SESSION_REFRESH,listener);
});
it('gives useful safe network and malformed-response errors',async()=>{
  fetcher.mockRejectedValue(new TypeError('Failed to fetch'));await expect(api('/customers')).rejects.toMatchObject({code:'NETWORK_ERROR'});
  fetcher.mockResolvedValue(new Response('not-json',{status:200}));await expect(api('/customers')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});
it('preserves aborts so stale reads can be cancelled',async()=>{
  fetcher.mockRejectedValue(new DOMException('Cancelled','AbortError'));await expect(api('/customers')).rejects.toMatchObject({name:'AbortError'});
});
it('passes explicit idempotency keys alongside session/CSRF without retrying',async()=>{
  setCsrfToken('csrf');fetcher.mockResolvedValue(Response.json({data:{id:'record'}}));await api('/customer-payments',{method:'POST',body:{amount:'5.00'},idempotencyKey:'test-key-123'});
  expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({'Idempotency-Key':'test-key-123','X-CSRF-Token':'csrf'});expect(fetcher).toHaveBeenCalledOnce();
});
it('retains backend validation field names for useful save errors',async()=>{
  setCsrfToken('csrf');fetcher.mockResolvedValue(Response.json({error:{code:'VALIDATION_ERROR',message:'Check the submitted fields.',fields:['amount','allocations.0.order_id']}},{status:400}));
  await expect(api('/supplier-payments',{method:'POST',body:{}})).rejects.toMatchObject({fields:['amount','allocations.0.order_id']});
});
it('uploads actual binary bytes with encoded names and session/CSRF headers',async()=>{
  const {uploadFile}=await import('../src/api/client');setCsrfToken('csrf');fetcher.mockResolvedValue(Response.json({data:{id:'file'}}));const file=new File(['bytes'],'मराठी.png',{type:'image/png'});await uploadFile('/files?category=ORDER_PRODUCT_IMAGE',file,'image/png');
  expect(fetcher.mock.calls[0]![1]?.body).toBe(file);expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({'X-File-Name':encodeURIComponent('मराठी.png'),'Content-Type':'image/png','X-CSRF-Token':'csrf'});
});
it('private downloads include cookies and enforce supported binary response types',async()=>{
  const {downloadFile}=await import('../src/api/client');fetcher.mockResolvedValue(new Response('bytes',{headers:{'Content-Type':'image/png'}}));expect((await downloadFile('file')).type).toBe('image/png');expect(fetcher.mock.calls[0]![1]).toMatchObject({credentials:'include',cache:'no-store'});
  fetcher.mockResolvedValue(new Response('<html>',{headers:{'Content-Type':'text/html'}}));await expect(downloadFile('file')).rejects.toMatchObject({code:'INVALID_FILE_RESPONSE'});
});
