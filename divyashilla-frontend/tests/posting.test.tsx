import { act,renderHook } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { setCsrfToken } from '../src/api/client';
import { usePosting } from '../src/modules/finance/usePosting';
it('an uncertain money post retries the identical payload and key explicitly',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('response lost')).mockResolvedValueOnce(Response.json({data:{id:'same-record'}}));vi.stubGlobal('fetch',fetcher);setCsrfToken('csrf');const saved=vi.fn();
  const {result}=renderHook(()=>usePosting('/customer-payments',saved));
  await act(()=>result.current.submit({amount:'10.00'}));expect(result.current.uncertain).toBe(true);expect(saved).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
  await act(()=>result.current.submit({amount:'999.00'}));expect(saved).toHaveBeenCalledOnce();expect(result.current.uncertain).toBe(false);
  expect(fetcher.mock.calls[0]![1]?.body).toBe(fetcher.mock.calls[1]![1]?.body);expect(fetcher.mock.calls[0]![1]?.headers).toEqual(fetcher.mock.calls[1]![1]?.headers);
});
it('a definitive backend denial permits correction with a fresh key',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({error:{code:'INVALID_CUSTOMER_BALANCE',message:'Balance invalid'}},{status:409})).mockResolvedValueOnce(Response.json({data:{id:'new-record'}}));vi.stubGlobal('fetch',fetcher);setCsrfToken('csrf');
  const {result}=renderHook(()=>usePosting('/customer-payments',vi.fn()));await act(()=>result.current.submit({amount:'100.00'}));expect(result.current.uncertain).toBe(false);expect(result.current.error).toBe('Balance invalid');
  await act(()=>result.current.submit({amount:'10.00'}));expect(fetcher.mock.calls[0]![1]?.headers).not.toEqual(fetcher.mock.calls[1]![1]?.headers);
});
