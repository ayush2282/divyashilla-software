import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/database.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { cookie,config,fixture,origin,testPassword } from './helpers.js';

type Body=Record<string,any>;
type Login={id:string;cookie:string;csrf:string};
let f:Awaited<ReturnType<typeof fixture>>,admin:Login,tanaji:Login,other:Login,customerId:string,designId:string,supplierId:string;
before(async()=>{
  f=await fixture();const users:Login[]=[];
  for (const [username,role] of [['ayush','ADMIN'],['tanaji','DELIVERY'],['other','DELIVERY']] as const) {
    const id=(await provisionUser(f.db,{name:username,username,role,password:testPassword})).id;
    await f.db.query('UPDATE divyashilla.users SET must_change_password=false WHERE id=$1',[id]);
    const res=await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username,password:testPassword}).expect(200);
    users.push({id,cookie:cookie(res),csrf:res.body.csrfToken});
  }
  [admin,tanaji,other]=users as [Login,Login,Login];
  customerId=(await call('post','customers',admin).send({name:'मराठी ग्राहक',phone:'9876543210',city:'Pune',address:'Customer home'}).expect(201)).body.data.id;
  designId=(await call('post','designs',admin).send({design_number:'DEL-1',design_name:'Hand carved stone',size:'3.15 feet',material:'Black stone'}).expect(201)).body.data.id;
  supplierId=(await call('post','suppliers',admin).send({name:'Supplier',phone:'9876543211'}).expect(201)).body.data.id;
});
after(async()=>{await f?.pg.close();});
function call(method:'get'|'post'|'patch'|'delete',path:string,user=tanaji,app=f.app) {
  return request(app)[method]('/api/v1/'+path).set('Origin',origin).set('Cookie',user.cookie).set('X-CSRF-Token',user.csrf);
}
async function setup(assigned:Login|null=tanaji,ready=true,extra:Body={}) {
  let order=(await call('post','orders',admin).send({customer_id:customerId,design_id:designId,supplier_id:supplierId,
    buying_price:'7000.25',selling_price:'11000.75',expected_delivery_date:'2026-10-10',order_date:'2026-10-01',...extra}).expect(201)).body.data;
  if (ready) {
    for (const order_status of ['IN_WORK','READY_FOR_DELIVERY']) order=(await call('post','orders/'+order.id+'/status',admin)
      .send({version:order.version,order_status,reason:'Prepare delivery'}).expect(200)).body.data;
  }
  const d=(await f.db.query<{id:string}>('SELECT id FROM divyashilla.deliveries WHERE order_id=$1',[order.id])).rows[0]!;
  let row=(await call('get','deliveries/'+d.id,admin).expect(200)).body.data;
  if (assigned) {
    if (ready) row=(await call('post','deliveries/'+d.id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:assigned.id,reason:'Delivery duty'}).expect(200)).body.data;
    else {await f.db.query('UPDATE divyashilla.orders SET assigned_delivery_user_id=$2 WHERE id=$1',[order.id,assigned.id]);row=(await call('get','deliveries/'+d.id,admin).expect(200)).body.data;}
  }
  return row as Body;
}
async function send(row:Body,user=tanaji,extra:Body={}) {
  return (await call('post','deliveries/'+row.delivery_id+'/send',user).send({version:row.version,driver_number:'+91 (98765) 43210',driver_or_bus_name:'Pune bus',...extra}).expect(200)).body.data as Body;
}
const forbidden=['buying_price','selling_price','profit','balance_amount','advance_amount','customer_net_received','customer_payments',
  'supplier_payments','supplier_id','supplier_net_paid','supplier_balance_amount','delivery_expense','other_expense','order_expenses','design_image_file_id','image_url'];
function safe(value:unknown) {
  if (!value || typeof value!=='object') return;
  for (const [key,child] of Object.entries(value)) {assert.ok(!forbidden.includes(key),'Leaked '+key);safe(child);}
}
function details(row:Body) {
  safe(row);assert.equal(row.customer_name,'मराठी ग्राहक');assert.equal(row.customer_phone,'9876543210');
  assert.equal(row.customer_city,'Pune');assert.equal(row.customer_address,'Customer home');
  assert.equal(row.design_number,'DEL-1');assert.equal(row.design_name,'Hand carved stone');assert.equal(row.size,'3.15 feet');
  assert.equal(row.material,'Black stone');assert.equal(row.expected_delivery_date,'2026-10-10');assert.equal(typeof row.order_number,'string');
}

test('ADMIN sees all delivery-safe rows; Tanaji sees only assigned ready/delivered orders with scoped counts',async()=>{
  const a=await setup(),b=await setup(other),u=await setup(null),draft=await setup(tanaji,false);
  const owner=await call('get','deliveries',admin).expect(200);assert.equal(owner.body.meta.total,4);safe(owner.body);
  const mine=await call('get','deliveries').expect(200);assert.equal(mine.body.meta.total,1);assert.equal(mine.body.data[0].delivery_id,a.delivery_id);details(mine.body.data[0]);
  const hiddenSearch=await call('get','deliveries').query({q:b.order_number}).expect(200);assert.equal(hiddenSearch.body.meta.total,0);
  const theirs=await call('get','deliveries',other).expect(200);assert.equal(theirs.body.meta.total,1);assert.equal(theirs.body.data[0].delivery_id,b.delivery_id);
  const selected=await call('get','deliveries',admin).query({assigned_delivery_user_id:tanaji.id}).expect(200);assert.equal(selected.body.meta.total,2);
  for (const d of [b,u,draft]) await call('get','deliveries/'+d.delivery_id).expect(404);
  await call('get','deliveries').query({assigned_delivery_user_id:other.id}).expect(403);
  await call('get','deliveries').query({assigned_delivery_user_id:tanaji.id}).expect(403);
});

test('unassigned and foreign delivery IDs deny every DELIVERY mutation without changing records',async()=>{
  for (const row of [await setup(other),await setup(null)]) {
    const prefix='deliveries/'+row.delivery_id;
    for (const [method,suffix,body] of [['post','send',{version:row.version,driver_number:'9876543210',driver_or_bus_name:'Bus'}],
      ['patch','driver',{version:row.version,bus_number:'MH12'}],['post','deliver',{version:row.version}],['post','issue',{version:row.version,reason:'Issue'}]] as const) {
      await call(method,prefix+'/'+suffix).send(body).expect(404);
    }
    await call('post',prefix+'/assign').send({version:row.version,assigned_delivery_user_id:tanaji.id,reason:'Spoof assignment'}).expect(403);
    const unchanged=(await call('get',prefix,admin).expect(200)).body.data;assert.equal(unchanged.version,row.version);assert.equal(unchanged.delivery_status,'READY_FOR_DELIVERY');
  }
});

test('sending and editing driver details use normalized fields, optional bus and versioned no-ops',async()=>{
  let row=await setup();
  await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,bus_number:'MH12'}).expect(409);
  const first=row;row=await send(row);details(row);assert.equal(row.delivery_status,'SENT');assert.equal(row.order_status,'READY_FOR_DELIVERY');
  assert.equal(row.driver_number,'+919876543210');assert.equal(row.driver_or_bus_name,'Pune bus');assert.equal(row.bus_number,null);assert.equal(row.version,first.version+1);
  await call('post','deliveries/'+row.delivery_id+'/send').send({version:row.version,driver_number:'9876543210',driver_or_bus_name:'Bus'}).expect(409);
  row=(await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,driver_number:'9876543212',driver_or_bus_name:'New driver',bus_number:' MH12 AB1234 '}).expect(200)).body.data;
  assert.equal(row.driver_number,'9876543212');assert.equal(row.driver_or_bus_name,'New driver');assert.equal(row.bus_number,'MH12 AB1234');
  const noop=(await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,bus_number:'MH12 AB1234'}).expect(200)).body.data;
  assert.equal(noop.version,row.version);assert.equal(noop.delivery_updated_at,row.delivery_updated_at);
  row=(await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,bus_number:null}).expect(200)).body.data;assert.equal(row.bus_number,null);
  const logs=await f.db.query<{action:string;before_data:Body;after_data:Body;actor_user_id:string;request_id:string}>(
    "SELECT * FROM divyashilla.activity_logs WHERE entity_id=$1 AND entity_type='DELIVERY' ORDER BY created_at",[row.delivery_id]);
  assert.deepEqual(logs.rows.map(r=>r.action),['DELIVERY_ASSIGNED','DELIVERY_SENT','DELIVERY_DRIVER_UPDATED','DELIVERY_DRIVER_UPDATED']);
  assert.equal(logs.rows[1]!.actor_user_id,tanaji.id);assert.ok(logs.rows.every(r=>r.request_id));
  for (const log of logs.rows) {safe(log.before_data);safe(log.after_data);}
});

test('SENT completion synchronizes order/delivery, stamps database time, logs both and remains safe',async()=>{
  let row=await setup();await call('post','deliveries/'+row.delivery_id+'/deliver').send({version:row.version}).expect(409);
  row=await send(row);const sent=row;
  row=(await call('post','deliveries/'+row.delivery_id+'/deliver').send({version:row.version}).expect(200)).body.data;
  details(row);assert.equal(row.delivery_status,'DELIVERED');assert.equal(row.order_status,'DELIVERED');assert.ok(row.delivered_at);assert.equal(row.updated_by,tanaji.id);
  assert.equal(row.version,sent.version+1);
  const order=(await call('get','orders/'+row.order_id,admin).expect(200)).body.data;
  assert.equal(order.order_status,'DELIVERED');assert.match(order.actual_delivery_date,/^\d{4}-\d{2}-\d{2}$/);assert.equal(order.profit,'4000.50');
  const deliveryLog=(await f.db.query<{after_data:Body}>('SELECT after_data FROM divyashilla.activity_logs WHERE entity_id=$1 AND action=$2',[row.delivery_id,'DELIVERY_COMPLETED'])).rows[0]!;
  assert.equal(deliveryLog.after_data.delivered_at,row.delivered_at);safe(deliveryLog.after_data);
  const orderLog=await f.db.query('SELECT id FROM divyashilla.activity_logs WHERE entity_id=$1 AND actor_user_id=$2 AND action=$3',[row.order_id,tanaji.id,'ORDER_STATUS_CHANGED']);assert.equal(orderLog.rows.length,1);
  const again=(await call('post','deliveries/'+row.delivery_id+'/deliver').send({version:row.version}).expect(200)).body.data;
  assert.equal(again.version,row.version);assert.equal(again.delivered_at,row.delivered_at);
  await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,bus_number:'Changed'}).expect(409);
  await call('post','deliveries/'+row.delivery_id+'/issue').send({version:row.version,reason:'Late issue'}).expect(409);
  await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:other.id,reason:'Reassign finished'}).expect(409);
});

test('issues require reasons, retain drivers, expose the latest safe reason and pause completion',async()=>{
  for (const alreadySent of [false,true]) {
    let row=await setup();if (alreadySent) row=await send(row);
    await call('post','deliveries/'+row.delivery_id+'/issue').send({version:row.version,reason:' '}).expect(400);
    row=(await call('post','deliveries/'+row.delivery_id+'/issue').send({version:row.version,reason:'Customer unavailable'}).expect(200)).body.data;
    assert.equal(row.delivery_status,'ISSUE');assert.equal(row.order_status,'READY_FOR_DELIVERY');assert.equal(row.issue_reason,'Customer unavailable');assert.equal(row.delivered_at,null);
    if (alreadySent) assert.equal(row.driver_number,'+919876543210');
    const same=(await call('post','deliveries/'+row.delivery_id+'/issue').send({version:row.version,reason:'Customer unavailable'}).expect(200)).body.data;assert.equal(same.version,row.version);
    const olderVersion=row.version;
    row=(await call('post','deliveries/'+row.delivery_id+'/issue').send({version:row.version,reason:'Bus breakdown'}).expect(200)).body.data;
    assert.equal(row.issue_reason,'Bus breakdown');assert.equal(row.version,olderVersion+1);
    const listed=await call('get','deliveries').query({delivery_status:'ISSUE',q:row.order_number}).expect(200);assert.equal(listed.body.data[0].issue_reason,'Bus breakdown');safe(listed.body);
    await call('post','deliveries/'+row.delivery_id+'/deliver').send({version:row.version}).expect(409);
    await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,bus_number:'Edit'}).expect(409);
  }
});

test('ADMIN assignment validates user role/activity; reassigning immediately revokes old access',async()=>{
  let row=await setup(null);
  for (const id of [admin.id,randomUUID()]) await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:id,reason:'Invalid target'}).expect(409);
  await f.db.query('UPDATE divyashilla.users SET is_active=false WHERE id=$1',[other.id]);
  await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:other.id,reason:'Inactive'}).expect(409);
  await f.db.query('UPDATE divyashilla.users SET is_active=true WHERE id=$1',[other.id]);
  row=(await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:tanaji.id,reason:'Assign'}).expect(200)).body.data;
  const same=(await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:tanaji.id,reason:'Same'}).expect(200)).body.data;assert.equal(same.version,row.version);
  row=await send(row);
  await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:null,reason:'Unassign sent'}).expect(409);
  row=(await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:other.id,reason:'Shift changed'}).expect(200)).body.data;
  await call('get','deliveries/'+row.delivery_id).expect(404);
  await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,bus_number:'Stolen'}).expect(404);
  assert.equal((await call('get','deliveries/'+row.delivery_id,other).expect(200)).body.data.assigned_delivery_user_id,other.id);
  let ready=await setup();ready=(await call('post','deliveries/'+ready.delivery_id+'/assign',admin).send({version:ready.version,assigned_delivery_user_id:null,reason:'Return to queue'}).expect(200)).body.data;
  assert.equal(ready.assigned_delivery_user_id,null);await call('get','deliveries/'+ready.delivery_id).expect(404);
});

test('ADMIN can dispatch/read unassigned deliveries; unfinished/cancelled orders cannot be dispatched',async()=>{
  let row=await setup(null);row=await send(row,admin);assert.equal(row.updated_by,admin.id);safe(row);
  await call('get','deliveries/'+row.delivery_id).expect(404);
  const draft=await setup(null,false);
  await call('post','deliveries/'+draft.delivery_id+'/send',admin).send({version:draft.version,driver_number:'9876543210',driver_or_bus_name:'Bus'}).expect(409);
  await call('post','deliveries/'+draft.delivery_id+'/assign',admin).send({version:draft.version,assigned_delivery_user_id:tanaji.id,reason:'Not ready'}).expect(409);
  const cancelled=await setup();
  await call('post','orders/'+cancelled.order_id+'/status',admin).send({version:cancelled.version,order_status:'CANCELLED',reason:'Cancelled'}).expect(200);
  await call('get','deliveries/'+cancelled.delivery_id).expect(404);
  const adminRow=(await call('get','deliveries/'+cancelled.delivery_id,admin).expect(200)).body.data;
  await call('post','deliveries/'+cancelled.delivery_id+'/send',admin).send({version:adminRow.version,driver_number:'9876543210',driver_or_bus_name:'Bus'}).expect(409);
});

test('order edits and delivery changes share a version, preventing stale driver/status overwrites',async()=>{
  const original=await setup();let row=await send(original);
  await call('post','deliveries/'+row.delivery_id+'/issue').send({version:original.version,reason:'Stale'}).expect(409);
  await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:original.version,bus_number:'Stale'}).expect(409);
  await call('patch','orders/'+row.order_id,admin).send({version:row.version,additional_work:'Owner edit'}).expect(200);
  await call('post','deliveries/'+row.delivery_id+'/deliver').send({version:row.version}).expect(409);
  row=(await call('get','deliveries/'+row.delivery_id).expect(200)).body.data;assert.equal(row.additional_work,'Owner edit');
  row=(await call('patch','deliveries/'+row.delivery_id+'/driver').send({version:row.version,bus_number:'MH12'}).expect(200)).body.data;
  assert.equal(row.delivery_status,'SENT');
});

test('delivery list search/date/status/sort/pagination remains scoped even with literal wildcard or injection text',async()=>{
  const app=createApp(f.db,config),row=await setup(tanaji,true,{delivery_name:'Literal%_recipient'});
  const found=await call('get','deliveries',tanaji,app).query({q:'%_recipient',delivery_status:'READY_FOR_DELIVERY',expected_from:'2026-10-10',expected_to:'2026-10-10'}).expect(200);
  assert.equal(found.body.meta.total,1);assert.equal(found.body.data[0].delivery_id,row.delivery_id);safe(found.body);
  const first=await call('get','deliveries',tanaji,app).query({limit:'1',page:'1',sort_by:'order_number',sort_order:'asc'}).expect(200);
  const second=await call('get','deliveries',tanaji,app).query({limit:'1',page:'2',sort_by:'order_number',sort_order:'asc'}).expect(200);
  assert.notEqual(first.body.data[0].delivery_id,second.body.data[0].delivery_id);assert.equal(first.body.meta.total,second.body.meta.total);
  const injection=await call('get','deliveries',tanaji,app).query({q:"' OR 1=1 --"}).expect(200);assert.equal(injection.body.meta.total,0);
  for (const query of [{sort_by:'selling_price'},{page:'0'},{limit:'101'},{delivery_status:'Sent'},{expected_from:'2026-02-30'},
    {expected_from:'2026-10-11',expected_to:'2026-10-10'},{unknown:'x'},{sort_order:'desc;drop table'}]) await call('get','deliveries',tanaji,app).query(query).expect(400);
});

test('strict validation rejects missing drivers, actor/price/status/time/assignment spoofing and malformed IDs',async()=>{
  const app=createApp(f.db,config),row=await setup(),path='deliveries/'+row.delivery_id;
  const valid={version:row.version,driver_number:'9876543210',driver_or_bus_name:'Bus'};
  for (const bad of [{version:row.version},{...valid,driver_number:''},{...valid,driver_number:'abc'},{...valid,driver_or_bus_name:' '},
    {...valid,driver_or_bus_name:'Bus\nX'},{...valid,bus_number:'Bus\nX'},{...valid,version:0},{...valid,version:'4'}]) await call('post',path+'/send',tanaji,app).send(bad).expect(400);
  for (const key of ['buying_price','selling_price','profit','order_status','delivery_status','updated_by','delivered_at','assigned_delivery_user_id']) {
    await call('post',path+'/send',tanaji,app).send({...valid,[key]:'spoof'}).expect(400);
    await call('patch',path+'/driver',tanaji,app).send({version:row.version,bus_number:'MH12',[key]:'spoof'}).expect(400);
  }
  await call('patch',path+'/driver',tanaji,app).send({version:row.version}).expect(400);
  await call('post',path+'/deliver',tanaji,app).send({version:row.version,delivered_at:'2026-10-01'}).expect(400);
  await call('get','deliveries/not-uuid',tanaji,app).expect(400);await call('get','deliveries/'+randomUUID(),tanaji,app).expect(404);
  await call('delete',path,admin,app).expect(404);await call('post','deliveries',admin,app).send({}).expect(404);
});

test('every endpoint requires login; every mutation requires trusted origin and CSRF',async()=>{
  const app=createApp(f.db,config),id=randomUUID();
  const endpoints:Array<['get'|'post'|'patch',string,Body]>=[['get','deliveries',{}],['get','deliveries/'+id,{}],
    ['post','deliveries/'+id+'/assign',{version:1,assigned_delivery_user_id:tanaji.id,reason:'Assign'}],
    ['post','deliveries/'+id+'/send',{version:1,driver_number:'9876543210',driver_or_bus_name:'Bus'}],
    ['patch','deliveries/'+id+'/driver',{version:1,bus_number:'MH12'}],['post','deliveries/'+id+'/deliver',{version:1}],
    ['post','deliveries/'+id+'/issue',{version:1,reason:'Issue'}]];
  for (const [method,path,payload] of endpoints) {
    await request(app)[method]('/api/v1/'+path).set('Origin',origin).send(payload).expect(401);
    if (method==='get') continue;
    await request(app)[method]('/api/v1/'+path).set('Origin',origin).set('Cookie',admin.cookie).send(payload).expect(403);
    await call(method,path,admin,app).set('Origin','https://untrusted.example').send(payload).expect(403);
  }
});

test('Tanaji remains denied financial and master endpoints and role/deactivation changes take effect live',async()=>{
  const app=createApp(f.db,config);
  for (const path of ['orders','customers','designs','suppliers','customer-payments','supplier-payments','order-expenses']) await call('get',path,tanaji,app).expect(403);
  await call('get','reports/dashboard',tanaji,app).expect(403);
  await f.db.query("UPDATE divyashilla.users SET role='ADMIN' WHERE id=$1",[other.id]);
  const asAdmin=await call('get','deliveries',other,app).expect(200);safe(asAdmin.body);
  await f.db.query("UPDATE divyashilla.users SET role='DELIVERY',is_active=false WHERE id=$1",[other.id]);
  await call('get','deliveries',other,app).expect(401);
  await f.db.query('UPDATE divyashilla.users SET is_active=true WHERE id=$1',[other.id]);
});

test('audit failures roll back assignment, dispatch, driver edits, issue and both Delivered statuses',async()=>{
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    if (sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated delivery audit failure');return tx.query(sql,values);
  }}))};
  const app=createApp(failing,config);let row=await setup(null);
  await call('post','deliveries/'+row.delivery_id+'/assign',admin,app).send({version:row.version,assigned_delivery_user_id:tanaji.id,reason:'Rollback'}).expect(500);
  let saved=(await call('get','deliveries/'+row.delivery_id,admin).expect(200)).body.data;assert.equal(saved.assigned_delivery_user_id,null);assert.equal(saved.version,row.version);
  row=(await call('post','deliveries/'+row.delivery_id+'/assign',admin).send({version:row.version,assigned_delivery_user_id:tanaji.id,reason:'Assign'}).expect(200)).body.data;
  await call('post','deliveries/'+row.delivery_id+'/send',tanaji,app).send({version:row.version,driver_number:'9876543210',driver_or_bus_name:'Bus'}).expect(500);
  saved=(await call('get','deliveries/'+row.delivery_id).expect(200)).body.data;assert.equal(saved.driver_number,null);assert.equal(saved.delivery_status,'READY_FOR_DELIVERY');assert.equal(saved.version,row.version);
  row=await send(row);
  await call('patch','deliveries/'+row.delivery_id+'/driver',tanaji,app).send({version:row.version,bus_number:'Must rollback'}).expect(500);
  await call('post','deliveries/'+row.delivery_id+'/issue',tanaji,app).send({version:row.version,reason:'Must rollback'}).expect(500);
  await call('post','deliveries/'+row.delivery_id+'/deliver',tanaji,app).send({version:row.version}).expect(500);
  saved=(await call('get','deliveries/'+row.delivery_id).expect(200)).body.data;
  assert.equal(saved.version,row.version);assert.equal(saved.delivery_status,'SENT');assert.equal(saved.order_status,'READY_FOR_DELIVERY');
  assert.equal(saved.delivered_at,null);assert.equal(saved.bus_number,null);assert.equal(saved.issue_reason,null);
  const failed=await f.db.query('SELECT id FROM divyashilla.activity_logs WHERE entity_id=$1 AND action=$2',[row.order_id,'ORDER_STATUS_CHANGED']);assert.equal(failed.rows.length,2);
});

test('failure writing the linked-order audit also rolls back the already-written delivery audit',async()=>{
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    if (sql.includes('INSERT INTO divyashilla.activity_logs') && values?.[2]==='ORDER') throw new Error('Simulated order audit failure');
    return tx.query(sql,values);
  }}))};
  const app=createApp(failing,config);let row=await setup();row=await send(row);
  await call('post','deliveries/'+row.delivery_id+'/deliver',tanaji,app).send({version:row.version}).expect(500);
  const saved=(await call('get','deliveries/'+row.delivery_id).expect(200)).body.data;assert.equal(saved.delivery_status,'SENT');assert.equal(saved.delivered_at,null);assert.equal(saved.version,row.version);
  assert.equal((await f.db.query('SELECT id FROM divyashilla.activity_logs WHERE entity_id=$1 AND action=$2',[row.delivery_id,'DELIVERY_COMPLETED'])).rows.length,0);
});


test('ADMIN assignee lookup exposes only active DELIVERY identifiers/names and validates filters',async()=>{
  const app=createApp(f.db,config);
  await request(app).get('/api/v1/deliveries/assignees').expect(401);
  await call('get','deliveries/assignees',tanaji,app).expect(403);
  const result=await call('get','deliveries/assignees',admin,app).query({q:'tanaji',limit:1}).expect(200);
  assert.equal(result.body.meta.total,1);assert.equal(result.body.data[0].id,tanaji.id);
  assert.deepEqual(Object.keys(result.body.data[0]).sort(),['id','name','username']);
  assert.equal((await call('get','deliveries/assignees',admin,app).query({id:admin.id}).expect(200)).body.meta.total,0);
  await f.db.query('UPDATE divyashilla.users SET is_active=false WHERE id=$1',[other.id]);
  assert.equal((await call('get','deliveries/assignees',admin,app).query({id:other.id}).expect(200)).body.meta.total,0);
  await f.db.query('UPDATE divyashilla.users SET is_active=true WHERE id=$1',[other.id]);
  await call('get','deliveries/assignees',admin,app).query({id:'bad'}).expect(400);
  await call('get','deliveries/assignees',admin,app).query({limit:101}).expect(400);
  await call('get','deliveries/assignees',admin,app).query({role:'ADMIN'}).expect(400);
});
