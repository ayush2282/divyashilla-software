import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/database.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { cookie,config,fixture,origin,testPassword } from './helpers.js';

type Body=Record<string,any>;
let f:Awaited<ReturnType<typeof fixture>>,adminId:string,adminCookie:string,csrf:string,deliveryCookie:string,deliveryCsrf:string;
let customerId:string,designId:string;
before(async()=>{
  f=await fixture();adminId=(await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword})).id;
  await provisionUser(f.db,{name:'Tanaji',username:'tanaji',role:'DELIVERY',password:testPassword});
  await f.db.query('UPDATE divyashilla.users SET must_change_password=false');
  for (const username of ['ayush','tanaji']) {
    const login=await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username,password:testPassword}).expect(200);
    if (username==='ayush') {adminCookie=cookie(login);csrf=login.body.csrfToken;}
    else {deliveryCookie=cookie(login);deliveryCsrf=login.body.csrfToken;}
  }
  customerId=(await call('post','customers').send({name:'Ledger customer',phone:'9876543210',city:'Pune'}).expect(201)).body.data.id;
  designId=(await call('post','designs').send({design_number:'LEDGER',design_name:'Stone Tulsi',size:'3.15 feet',material:'Stone'}).expect(201)).body.data.id;
});
after(async()=>{await f?.pg.close();});
function call(method:'get'|'post'|'patch'|'delete',path:string,app=f.app,key:string=randomUUID()) {
  return request(app)[method]('/api/v1/'+path).set('Cookie',adminCookie).set('Origin',origin).set('X-CSRF-Token',csrf).set('Idempotency-Key',key);
}
async function order(extra:Body={}) {
  const supplier=extra.supplier_id??(await call('post','suppliers').send({name:'Supplier '+randomUUID().slice(0,8),phone:'9876543211'}).expect(201)).body.data.id;
  return (await call('post','orders').send({customer_id:customerId,design_id:designId,supplier_id:supplier,buying_price:'700',selling_price:'1000',...extra}).expect(201)).body.data as Body;
}
const receipt=(id:string,amount='100',extra:Body={})=>({order_id:id,amount,direction:'RECEIPT',purpose:'ADVANCE',payment_date:'2026-10-01',payment_method:'UPI',...extra});
const supplierPayment=(supplierId:string,amount='100',extra:Body={})=>({supplier_id:supplierId,amount,direction:'PAYMENT',payment_date:'2026-10-01',payment_method:'BANK_TRANSFER',...extra});
const expense=(id:string,amount='10',extra:Body={})=>({order_id:id,amount,category:'OTHER',expense_date:'2026-10-01',...extra});
async function add(path:string,body:Body) {return (await call('post',path).send(body).expect(201)).body.data as Body;}
async function balance(id:string) {return (await call('get','customer-payments/orders/'+id+'/balance').expect(200)).body.data as Body;}
async function supplierBalance(id:string) {return (await call('get','supplier-payments/suppliers/'+id+'/balance').expect(200)).body.data as Body;}
async function voided(path:string,id:string,code=200,app=f.app) {
  return call('post',path+'/'+id+'/void',app).send({reason:'Correct recorded transaction'}).expect(code);
}

test('customer receipts and refunds update the existing financial view with exact cents',async()=>{
  const o=await order({advance_amount:'150'});
  const a=await add('customer-payments',receipt(o.id,'200.10'));
  const b=await add('customer-payments',receipt(o.id,'100.20',{purpose:'INSTALLMENT',payment_method:'CASH'}));
  assert.equal(a.received_by,adminId);assert.equal(a.processed_by,adminId);assert.equal(a.status,'POSTED');
  assert.equal(a.amount,'200.10');assert.equal(a.payment_date,'2026-10-01');
  const refunded=await add('customer-payments',{order_id:o.id,amount:'50.05',direction:'REFUND',payment_date:'2026-10-02',payment_method:'UPI'});
  assert.equal(refunded.purpose,null);assert.equal(refunded.received_by,null);assert.equal(refunded.processed_by,adminId);
  const total=await balance(o.id);assert.equal(total.customer_net_received,'250.25');assert.equal(total.balance_amount,'749.75');
  assert.equal(total.advance_receipts_recorded,'200.10');assert.equal(total.advance_amount,'150.00');
  assert.equal((await call('get','customer-payments/'+b.id).expect(200)).body.data.id,b.id);
});

test('customer overpayments/refunds are rejected and failed writes leave no records',async()=>{
  const o=await order();
  await call('post','customer-payments').send({order_id:o.id,amount:'0.01',direction:'REFUND',payment_date:'2026-10-01',payment_method:'CASH'}).expect(409);
  await add('customer-payments',receipt(o.id,'1000'));
  await call('post','customer-payments').send(receipt(o.id,'0.01')).expect(409);
  await call('post','customer-payments').send({order_id:o.id,amount:'1000.01',direction:'REFUND',payment_date:'2026-10-01',payment_method:'CASH'}).expect(409);
  const rows=await call('get','customer-payments').query({order_id:o.id}).expect(200);assert.equal(rows.body.meta.total,1);
  assert.equal((await balance(o.id)).balance_amount,'0.00');
});

test('customer voiding enforces resulting balances, retains history and is a no-op when repeated',async()=>{
  const o=await order(),r=await add('customer-payments',receipt(o.id,'100'));
  const refund=await add('customer-payments',{order_id:o.id,amount:'50',direction:'REFUND',payment_date:'2026-10-01',payment_method:'CASH'});
  await voided('customer-payments',r.id,409);
  const v=(await voided('customer-payments',refund.id)).body.data;
  assert.equal(v.status,'VOID');assert.equal(v.voided_by,adminId);assert.ok(v.voided_at);
  assert.equal(v.created_at,refund.created_at);assert.equal(v.amount,refund.amount);
  assert.equal((await voided('customer-payments',refund.id)).body.data.updated_at,v.updated_at);
  await voided('customer-payments',r.id);assert.equal((await balance(o.id)).customer_net_received,'0');
  const list=await call('get','customer-payments').query({order_id:o.id,status:'all'}).expect(200);assert.equal(list.body.meta.total,2);
  const logs=await f.db.query<{action:string;reason:string;actor_user_id:string;request_id:string}>(
    'SELECT * FROM divyashilla.activity_logs WHERE entity_id=$1 ORDER BY created_at',[refund.id]);
  assert.deepEqual(logs.rows.map(r=>r.action),['CUSTOMER_PAYMENT_POSTED','CUSTOMER_PAYMENT_VOIDED']);
  assert.equal(logs.rows[1]!.reason,'Correct recorded transaction');assert.ok(logs.rows.every(r=>r.actor_user_id===adminId && r.request_id));
});

test('voiding a refund cannot make the customer overpaid after a replacement receipt',async()=>{
  const o=await order();await add('customer-payments',receipt(o.id,'1000'));
  const refund=await add('customer-payments',{order_id:o.id,amount:'100',direction:'REFUND',payment_date:'2026-10-01',payment_method:'CASH'});
  await add('customer-payments',receipt(o.id,'100'));await voided('customer-payments',refund.id,409);
});

test('cancelled orders allow refunds and expenses but reject new customer receipts',async()=>{
  const o=await order();await add('customer-payments',receipt(o.id,'100'));
  await call('post','orders/'+o.id+'/status').send({version:1,order_status:'CANCELLED',reason:'Customer cancelled'}).expect(200);
  await call('post','customer-payments').send(receipt(o.id)).expect(409);
  await add('customer-payments',{order_id:o.id,amount:'100',direction:'REFUND',payment_date:'2026-10-01',payment_method:'CASH'});
  await add('order-expenses',expense(o.id,'20'));assert.equal((await balance(o.id)).balance_amount,'1000.00');
});

test('supplier payments support multiple allocations, unallocated credit and order balances',async()=>{
  const a=await order(),b=await order({supplier_id:a.supplier_id,buying_price:'300'});
  const p=await add('supplier-payments',supplierPayment(a.supplier_id,'700',{allocations:[{order_id:a.id,amount:'500'},{order_id:b.id,amount:'100'}]}));
  assert.equal(p.paid_by,adminId);assert.equal(p.processed_by,adminId);assert.equal(p.allocations.length,2);
  const view=(await f.db.query<{supplier_net_paid:string;supplier_balance_amount:string}>(
    'SELECT supplier_net_paid::text,supplier_balance_amount::text FROM divyashilla.order_financials WHERE order_id=$1',[a.id])).rows[0]!;
  assert.equal(view.supplier_net_paid,'500.00');assert.equal(view.supplier_balance_amount,'200.00');
  const filtered=await call('get','supplier-payments').query({order_id:a.id}).expect(200);assert.equal(filtered.body.meta.total,1);
  const totals=await supplierBalance(a.supplier_id);assert.equal(totals.known_liability,'1000.00');
  assert.equal(totals.net_paid,'700.00');assert.equal(totals.net_allocated,'600.00');assert.equal(totals.unallocated_net_advance,'100.00');
  assert.equal(totals.payable,'300.00');
  assert.equal((await call('get','supplier-payments/'+p.id).expect(200)).body.data.allocations.length,2);
});

test('allocations can be added to an unallocated payment, but cannot exceed it or repeat an order',async()=>{
  const a=await order(),b=await order({supplier_id:a.supplier_id});
  const p=await add('supplier-payments',supplierPayment(a.supplier_id,'500'));
  const key=randomUUID(),input={allocations:[{order_id:a.id,amount:'300'}]};
  const res=await call('post','supplier-payments/'+p.id+'/allocations',f.app,key).send(input).expect(200);
  assert.equal(res.body.data.allocations.length,1);
  const replay=await call('post','supplier-payments/'+p.id+'/allocations',f.app,key).send(input).expect(200);
  assert.equal(replay.headers['idempotency-replayed'],'true');
  await call('post','supplier-payments/'+p.id+'/allocations').send(input).expect(409);
  await call('post','supplier-payments/'+p.id+'/allocations').send({allocations:[{order_id:b.id,amount:'201'}]}).expect(409);
  await call('post','supplier-payments/'+p.id+'/allocations').send({allocations:[{order_id:b.id,amount:'200'}]}).expect(200);
  await voided('supplier-payments',p.id);
  await call('post','supplier-payments/'+p.id+'/allocations').send({allocations:[{order_id:randomUUID(),amount:'1'}]}).expect(409);
  assert.equal((await supplierBalance(a.supplier_id)).net_paid,'0');
});

test('supplier totals and per-order costs prevent overpayment; invalid links and unknown costs are rejected',async()=>{
  const a=await order(),b=await order({supplier_id:a.supplier_id}),foreign=await order();
  await call('post','supplier-payments').send(supplierPayment(a.supplier_id,'1400.01')).expect(409);
  await call('post','supplier-payments').send(supplierPayment(a.supplier_id,'701',{allocations:[{order_id:a.id,amount:'701'}]})).expect(409);
  await call('post','supplier-payments').send(supplierPayment(a.supplier_id,'100',{allocations:[{order_id:foreign.id,amount:'100'}]})).expect(409);
  await call('post','supplier-payments').send(supplierPayment(a.supplier_id,'100',{allocations:[{order_id:randomUUID(),amount:'100'}]})).expect(404);
  await call('post','supplier-payments').send(supplierPayment(a.supplier_id,'100',{allocations:[{order_id:a.id,amount:'100.01'}]})).expect(409);
  const unknown=await order({supplier_id:a.supplier_id,buying_price:null});
  await call('post','supplier-payments').send(supplierPayment(a.supplier_id,'10',{allocations:[{order_id:unknown.id,amount:'10'}]})).expect(409);
  await add('supplier-payments',supplierPayment(a.supplier_id,'700',{allocations:[{order_id:a.id,amount:'700'}]}));
  await call('post','supplier-payments').send(supplierPayment(a.supplier_id,'1',{allocations:[{order_id:a.id,amount:'1'}]})).expect(409);
  await add('supplier-payments',supplierPayment(a.supplier_id,'700',{allocations:[{order_id:b.id,amount:'700'}]}));
  assert.equal((await supplierBalance(a.supplier_id)).payable,'0.00');
});

test('supplier refunds must be funded at supplier, unallocated and allocated order levels',async()=>{
  const o=await order();
  await call('post','supplier-payments').send(supplierPayment(o.supplier_id,'1',{direction:'REFUND'})).expect(409);
  await add('supplier-payments',supplierPayment(o.supplier_id,'500',{allocations:[{order_id:o.id,amount:'400'}]}));
  await call('post','supplier-payments').send(supplierPayment(o.supplier_id,'101',{direction:'REFUND'})).expect(409);
  await call('post','supplier-payments').send(supplierPayment(o.supplier_id,'401',{direction:'REFUND',allocations:[{order_id:o.id,amount:'401'}]})).expect(409);
  const refund=await add('supplier-payments',supplierPayment(o.supplier_id,'150',{direction:'REFUND',allocations:[{order_id:o.id,amount:'100'}]}));
  assert.equal(refund.paid_by,null);assert.equal(refund.processed_by,adminId);
  const total=await supplierBalance(o.supplier_id);assert.equal(total.net_paid,'350.00');assert.equal(total.net_allocated,'300.00');assert.equal(total.unallocated_net_advance,'50.00');
});

test('supplier voids preserve allocations and reject removing funds backing refunds',async()=>{
  const o=await order();
  const paid=await add('supplier-payments',supplierPayment(o.supplier_id,'300',{allocations:[{order_id:o.id,amount:'300'}]}));
  const refund=await add('supplier-payments',supplierPayment(o.supplier_id,'100',{direction:'REFUND',allocations:[{order_id:o.id,amount:'100'}]}));
  await voided('supplier-payments',paid.id,409);
  await voided('supplier-payments',refund.id);const v=(await voided('supplier-payments',paid.id)).body.data;
  assert.equal(v.status,'VOID');assert.equal(v.allocations.length,1);assert.equal(v.voided_by,adminId);
  assert.equal((await supplierBalance(o.supplier_id)).net_paid,'0');
  assert.equal((await call('get','supplier-payments').query({supplier_id:o.supplier_id,status:'VOID'}).expect(200)).body.meta.total,2);
});

test('supplier refund void is rejected if restored payment would exceed known costs',async()=>{
  const o=await order();await add('supplier-payments',supplierPayment(o.supplier_id,'700'));
  const refund=await add('supplier-payments',supplierPayment(o.supplier_id,'100',{direction:'REFUND'}));
  await add('supplier-payments',supplierPayment(o.supplier_id,'100'));await voided('supplier-payments',refund.id,409);
});

test('inactive suppliers can receive refunds but not new payments',async()=>{
  const o=await order();await add('supplier-payments',supplierPayment(o.supplier_id,'100'));
  await call('post','suppliers/'+o.supplier_id+'/deactivate').send({reason:'Inactive'}).expect(200);
  await call('post','supplier-payments').send(supplierPayment(o.supplier_id,'1')).expect(409);
  await add('supplier-payments',supplierPayment(o.supplier_id,'100',{direction:'REFUND'}));
});

test('order price edits cannot undermine allocated or unallocated supplier funds',async()=>{
  const o=await order();await add('supplier-payments',supplierPayment(o.supplier_id,'500',{allocations:[{order_id:o.id,amount:'400'}]}));
  await call('patch','orders/'+o.id).send({version:1,buying_price:'399'}).expect(409);
  await call('patch','orders/'+o.id).send({version:1,buying_price:'450'}).expect(409); // Supplier total is still 500.
  await call('patch','orders/'+o.id).send({version:1,buying_price:null}).expect(409);
  const saved=(await call('get','orders/'+o.id).expect(200)).body.data;assert.equal(saved.version,1);assert.equal(saved.buying_price,'700.00');
  await call('patch','orders/'+o.id).send({version:1,buying_price:'500'}).expect(200);
});

test('expense additions and voids change profit without multiplying receipt totals',async()=>{
  const o=await order();await add('customer-payments',receipt(o.id,'100'));await add('customer-payments',receipt(o.id,'200'));
  const d=await add('order-expenses',expense(o.id,'25.10',{category:'DELIVERY'}));
  const other=await add('order-expenses',expense(o.id,'14.90'));
  assert.equal(d.created_by,adminId);assert.equal(d.expense_date,'2026-10-01');assert.equal(d.status,'POSTED');
  let read=(await call('get','orders/'+o.id).expect(200)).body.data;
  assert.equal(read.profit,'260.00');assert.equal(read.delivery_expense,'25.10');assert.equal(read.other_expense,'14.90');assert.equal(read.customer_net_received,'300.00');
  await voided('order-expenses',d.id);read=(await call('get','orders/'+o.id).expect(200)).body.data;
  assert.equal(read.profit,'285.10');assert.equal(read.delivery_expense,'0');
  assert.equal((await call('get','order-expenses/'+other.id).expect(200)).body.data.amount,'14.90');
});

test('idempotency prevents duplicate posts and rejects changed or expired keys for each ledger',async()=>{
  const o=await order();
  for (const [path,payload] of [['customer-payments',receipt(o.id,'10')],['supplier-payments',supplierPayment(o.supplier_id,'10')],['order-expenses',expense(o.id,'10')]] as const) {
    const key=randomUUID(),first=await call('post',path,f.app,key).send(payload).expect(201);
    const repeat=await call('post',path,f.app,key).send({...payload}).expect(201);
    assert.equal(repeat.body.data.id,first.body.data.id);assert.equal(repeat.headers['idempotency-replayed'],'true');
    assert.equal(first.headers.location,'/api/v1/'+path+'/'+first.body.data.id);
    await call('post',path,f.app,key).send({...payload,amount:'11'}).expect(409);
    await f.db.query(`UPDATE divyashilla.idempotency_requests SET expires_at=created_at+interval '1 microsecond' WHERE key=$1`,[key]);
    await call('post',path,f.app,key).send(payload).expect(409);
    const logs=await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.activity_logs WHERE entity_id=$1',[first.body.data.id]);assert.equal(logs.rows[0]!.n,'1');
  }
});

test('ledger list filters are strict, dates inclusive, and pagination retains void history',async()=>{
  const o=await order();
  const paths=[['customer-payments',receipt(o.id,'10'),{order_id:o.id,direction:'RECEIPT'}],
    ['supplier-payments',supplierPayment(o.supplier_id,'10'),{supplier_id:o.supplier_id,direction:'PAYMENT'}],
    ['order-expenses',expense(o.id,'10'),{order_id:o.id,category:'OTHER'}]] as const;
  for (const [path,payload,filter] of paths) {
    const a=await add(path,payload);await add(path,payload);await voided(path,a.id);
    const result=await call('get',path).query({...filter,status:'all',date_from:'2026-10-01',date_to:'2026-10-01',limit:'1',page:'2',sort_order:'asc'}).expect(200);
    assert.equal(result.body.meta.total,2);assert.equal(result.body.meta.total_pages,2);assert.equal(result.body.data.length,1);
    assert.equal((await call('get',path).query({...filter,status:'VOID'}).expect(200)).body.meta.total,1);
    for (const query of [{limit:'101'},{page:'0'},{status:'deleted'},{sort_order:'desc;drop table'},{date_from:'2026-10-02',date_to:'2026-10-01'},{unknown:'x'}]) await call('get',path).query(query).expect(400);
  }
});

test('strict ledger validation rejects zero/negative/rounded money, actor/status spoofing and bad allocations',async()=>{
  // Separate app instance keeps rate-limit tests independent of the number of checks in this suite.
  const app=createApp(f.db,config),o=await order();
  for (const [path,payload] of [['customer-payments',receipt(o.id)],['supplier-payments',supplierPayment(o.supplier_id)],['order-expenses',expense(o.id)]] as const) {
    for (const amount of ['0','-1','1.001','NaN','Infinity',1,'1e2']) await call('post',path,app).send({...payload,amount}).expect(400);
    for (const field of ['received_by','paid_by','processed_by','created_by','status','voided_by']) await call('post',path,app).send({...payload,[field]:adminId}).expect(400);
    await request(app).post('/api/v1/'+path).set('Origin',origin).set('Cookie',adminCookie).set('X-CSRF-Token',csrf).send(payload).expect(400);
    await call('post',path,app,'bad').send(payload).expect(400);
    await call('post',path,app).send({...payload,[path==='order-expenses'?'expense_date':'payment_date']:'2026-02-30'}).expect(400);
    await call('post',path,app).send({...payload,note:'bad\u0000note'}).expect(400);
  }
  await call('post','customer-payments',app).send({...receipt(o.id),direction:'REFUND',purpose:'ADVANCE'}).expect(400);
  await call('post','supplier-payments',app).send(supplierPayment(o.supplier_id,'100',{allocations:[{order_id:o.id,amount:'10'},{order_id:o.id,amount:'10'}]})).expect(400);
  await call('post','supplier-payments/'+randomUUID()+'/allocations',app).send({allocations:[]}).expect(400);
  await call('post','order-expenses',app).send(expense(o.id,'1',{category:'TRANSPORT'})).expect(400);
});

test('every ledger/balance/allocation endpoint denies DELIVERY and anonymous callers',async()=>{
  const app=createApp(f.db,config),id=randomUUID();
  const endpoints:Array<['get'|'post',string]>=[];
  for (const path of ['customer-payments','supplier-payments','order-expenses']) endpoints.push(['get',path],['post',path],['get',path+'/'+id],['post',path+'/'+id+'/void']);
  endpoints.push(['get','customer-payments/orders/'+id+'/balance'],['get','supplier-payments/suppliers/'+id+'/balance'],['post','supplier-payments/'+id+'/allocations']);
  for (const [method,path] of endpoints) {
    await request(app)[method]('/api/v1/'+path).set('Origin',origin).send({}).expect(401);
    await request(app)[method]('/api/v1/'+path).set('Origin',origin).set('Cookie',deliveryCookie).set('X-CSRF-Token',deliveryCsrf).send({}).expect(403);
  }
});

test('ledger writes require CSRF/origin, void reasons and valid IDs; PATCH/DELETE are absent',async()=>{
  const app=createApp(f.db,config),o=await order();
  for (const [path,payload] of [['customer-payments',receipt(o.id)],['supplier-payments',supplierPayment(o.supplier_id)],['order-expenses',expense(o.id)]] as const) {
    await request(app).post('/api/v1/'+path).set('Cookie',adminCookie).set('Origin',origin).set('Idempotency-Key',randomUUID()).send(payload).expect(403);
    await call('post',path,app).set('Origin','https://bad.example').send(payload).expect(403);
    const id=randomUUID();await call('get',path+'/invalid',app).expect(400);await call('get',path+'/'+id,app).expect(404);
    await call('post',path+'/'+id+'/void',app).send({reason:' '}).expect(400);
    await call('post',path+'/'+id+'/void',app).send({reason:'Valid reason'}).expect(404);
    await call('patch',path+'/'+id,app).send({amount:'1'}).expect(404);await call('delete',path+'/'+id,app).expect(404);
  }
  await call('get','customer-payments/orders/'+randomUUID()+'/balance',app).expect(404);
  await call('get','supplier-payments/suppliers/'+randomUUID()+'/balance',app).expect(404);
});

test('audit failures roll back ledger insert, allocations, idempotency and void metadata',async()=>{
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    if (sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated audit failure');return tx.query(sql,values);
  }}))};
  const app=createApp(failing,config),o=await order();
  for (const [path,payload,table] of [['customer-payments',receipt(o.id),'customer_payments'],
    ['supplier-payments',supplierPayment(o.supplier_id,'100',{allocations:[{order_id:o.id,amount:'100'}]}),'supplier_payments'],
    ['order-expenses',expense(o.id),'order_expenses']] as const) {
    const count=async()=>Number((await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.'+table)).rows[0]!.n);
    const before=await count(),key=randomUUID();await call('post',path,app,key).send(payload).expect(500);assert.equal(await count(),before);
    assert.equal((await f.db.query('SELECT id FROM divyashilla.idempotency_requests WHERE key=$1',[key])).rows.length,0);
    const saved=await add(path,payload);await voided(path,saved.id,500,app);
    assert.equal((await call('get',path+'/'+saved.id).expect(200)).body.data.status,'POSTED');
  }
  const p=await add('supplier-payments',supplierPayment(o.supplier_id,'100'));
  await call('post','supplier-payments/'+p.id+'/allocations',app).send({allocations:[{order_id:o.id,amount:'50'}]}).expect(500);
  assert.equal((await call('get','supplier-payments/'+p.id).expect(200)).body.data.allocations.length,0);
});

test('financial lock is acquired before order mutations as well as ledger writes',async()=>{
  const statements:string[]=[],tracked:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    statements.push(sql);return tx.query(sql,values);
  }}))};
  const app=createApp(tracked,config),o=await order();
  await call('post','customer-payments',app).send(receipt(o.id)).expect(201);
  assert.ok(statements[0]!.includes('pg_advisory_xact_lock'));statements.length=0;
  await call('patch','orders/'+o.id,app).send({version:1,buying_price:'800'}).expect(200);
  assert.ok(statements[0]!.includes('pg_advisory_xact_lock'));
});

test('concurrent retries in the integration adapter produce one receipt and one audit entry',async()=>{
  const o=await order(),key=randomUUID(),payload=receipt(o.id,'100');
  const results=await Promise.all([call('post','customer-payments',f.app,key).send(payload).expect(201),
    call('post','customer-payments',f.app,key).send(payload).expect(201)]);
  assert.deepEqual(results[0]!.body,results[1]!.body);
  assert.equal((await balance(o.id)).customer_net_received,'100.00');
  const logs=await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.activity_logs WHERE entity_id=$1',[results[0]!.body.data.id]);
  assert.equal(logs.rows[0]!.n,'1');
});

test('idempotency persistence failure rolls back a posted receipt and its already-written audit',async()=>{
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async<T extends object>(sql:string,values?:unknown[])=>{
    const result=await tx.query<T>(sql,values);
    if (sql.includes('INSERT INTO divyashilla.idempotency_requests')) throw new Error('Simulated persistence failure');return result;
  }}))};
  const app=createApp(failing,config),o=await order(),key=randomUUID();
  await call('post','customer-payments',app,key).send(receipt(o.id)).expect(500);
  assert.equal((await balance(o.id)).customer_net_received,'0');
  assert.equal((await f.db.query('SELECT id FROM divyashilla.idempotency_requests WHERE key=$1',[key])).rows.length,0);
  const rows=await f.db.query('SELECT id FROM divyashilla.activity_logs WHERE entity_type=$1 AND after_data->>\'order_id\'=$2',['CUSTOMER_PAYMENT',o.id]);
  assert.equal(rows.rows.length,0);
});
