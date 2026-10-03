import { SESSION_REFRESH } from '../src/api/client';
import { expect,it,vi } from 'vitest';
import { act,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import type { Session } from '../src/api/types';
function setup(role:'ADMIN'|'DELIVERY',path:string,mustChangePassword=false) {
  const session:Session={user:{id:'1',name:role==='ADMIN'?'Ayush':'Tanaji',username:'user',role,mustChangePassword},csrfToken:'test',expiresAt:new Date(Date.now()+3600000).toISOString()};
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).endsWith('/auth/me')?Response.json(session):Response.json({data:[],meta:{page:1,limit:20,total:0,total_pages:0}}));
  vi.stubGlobal('fetch',fetcher);
  render(<MemoryRouter initialEntries={[path]}><AuthProvider><App/></AuthProvider></MemoryRouter>);return fetcher;
}
it('redirects DELIVERY away from customer screens without making an ADMIN data request',async()=>{
  const fetcher=setup('DELIVERY','/customers');await screen.findByRole('heading',{name:'Welcome, Tanaji'});
  expect(screen.queryByRole('link',{name:'Customers'})).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(call=>String(call[0]).includes('/customers'))).toBe(false);
});
it('redirects first-login accounts to password change before any business request',async()=>{
  const fetcher=setup('ADMIN','/dashboard',true);await screen.findByRole('heading',{name:'Choose your own password'});
  expect(fetcher.mock.calls.some(call=>String(call[0]).includes('/reports/'))).toBe(false);
});
it('shows the ADMIN navigation and a helpful empty state',async()=>{
  setup('ADMIN','/customers');await screen.findByRole('heading',{name:'Customers'});await screen.findByRole('heading',{name:'No matching records'});
  expect(screen.getAllByRole('link',{name:'Add customer'}).length).toBeGreaterThan(0);
});
it('restores no protected route for an expired session',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:{code:'SESSION_INVALID',message:'Please sign in'}},{status:401})));
  render(<MemoryRouter initialEntries={['/suppliers']}><AuthProvider><App/></AuthProvider></MemoryRouter>);
  await screen.findByRole('heading',{name:'Sign in to your workspace'});expect(screen.queryByRole('link',{name:'Suppliers'})).not.toBeInTheDocument();
});
it('makes an initial network failure retryable',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));
  render(<MemoryRouter><AuthProvider><App/></AuthProvider></MemoryRouter>);await waitFor(()=>expect(screen.getByRole('button',{name:'Try again'})).toBeInTheDocument());
});
it('never requests order/financial data for a DELIVERY user opening an order URL',async()=>{
  const fetcher=setup('DELIVERY','/orders/12345678-1234-4123-8123-123456789012');await screen.findByRole('heading',{name:'Welcome, Tanaji'});
  expect(screen.queryByRole('link',{name:'Orders'})).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(call=>String(call[0]).includes('/orders'))).toBe(false);
});
it('shows ADMIN orders navigation and empty order state',async()=>{
  setup('ADMIN','/orders');await screen.findByRole('heading',{name:'Orders'});await screen.findByRole('heading',{name:'No matching orders'});
  expect(screen.getAllByRole('link',{name:'Create order'}).length).toBeGreaterThan(0);
});
for(const path of ['/customer-payments','/supplier-payments/new','/order-expenses/new','/supplier-payments/12345678-1234-4123-8123-123456789012/allocations'])it('blocks DELIVERY financial route '+path+' before requesting ledger data',async()=>{
  const fetcher=setup('DELIVERY',path);await screen.findByRole('heading',{name:'Welcome, Tanaji'});
  for(const name of ['Customer payments','Supplier payments','Order expenses'])expect(screen.queryByRole('link',{name})).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(call=>/customer-payments|supplier-payments|order-expenses/.test(String(call[0])))).toBe(false);
});
it('ADMIN financial list offers creation and an empty state',async()=>{
  setup('ADMIN','/customer-payments');await screen.findByRole('heading',{name:'Customer payments'});await screen.findByRole('heading',{name:'No matching financial records'});expect(screen.getAllByRole('link',{name:'Add customer payment'}).length).toBeGreaterThan(0);
});
it('DELIVERY dashboard uses scoped delivery APIs without financial/master queries',async()=>{
  const fetcher=setup('DELIVERY','/workspace');await screen.findByRole('heading',{name:'Welcome, Tanaji'});await screen.findByRole('heading',{name:'No matching deliveries'});expect(screen.getByRole('button',{name:'Sent queue'})).toBeInTheDocument();
  expect(fetcher.mock.calls.some(call=>/\/orders|\/reports|\/customers|\/designs|\/suppliers/.test(String(call[0])))).toBe(false);
});

it('shared delivery pages clear ADMIN results after a live role change',async()=>{
  let role:'ADMIN'|'DELIVERY'='ADMIN';
  vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockImplementation(async url=>{
    if(String(url).endsWith('/auth/me'))return Response.json({user:{id:'same-user',name:'Ayush',username:'ayush',role,mustChangePassword:false},csrfToken:'csrf',expiresAt:new Date(Date.now()+3600000).toISOString()});
    return Response.json({data:role==='ADMIN'?[{delivery_id:'12345678-1234-4123-8123-123456789012',order_number:'1001',customer_name:'Foreign recipient',customer_city:'Pune',customer_phone:'9876543210',design_number:'701',design_name:'Stone',size:'4 feet',expected_delivery_date:null,delivery_status:'READY_FOR_DELIVERY'}]:[],meta:{page:1,limit:20,total:role==='ADMIN'?1:0,total_pages:role==='ADMIN'?1:0}});
  }));
  render(<MemoryRouter initialEntries={['/deliveries']}><AuthProvider><App/></AuthProvider></MemoryRouter>);await screen.findByText('Foreign recipient');
  await act(async()=>{role='DELIVERY';window.dispatchEvent(new Event(SESSION_REFRESH));});await screen.findByRole('heading',{name:'No matching deliveries'});expect(screen.queryByText('Foreign recipient')).not.toBeInTheDocument();
});
