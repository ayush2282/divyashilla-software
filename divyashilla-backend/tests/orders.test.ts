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
let customer:Body,design:Body,supplier:Body;
before(async()=>{
  f=await fixture();
  adminId=(await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword})).id;
  await provisionUser(f.db,{name:'Tanaji',username:'tanaji',role:'DELIVERY',password:testPassword});
  await f.db.query('UPDATE divyashilla.users SET must_change_password=false');
  const admin=await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username:'ayush',password:testPassword}).expect(200);
  const delivery=await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username:'tanaji',password:testPassword}).expect(200);
  adminCookie=cookie(admin);csrf=admin.body.csrfToken;deliveryCookie=cookie(delivery);deliveryCsrf=delivery.body.csrfToken;
  customer=(await call('post','customers').send({name:'मराठी ग्राहक',phone:'9876543210',city:'Pune',address:'Original address'}).expect(201)).body.data;
  design=(await call('post','designs').send({design_number:'DS-1',design_name:'Stone Tulsi',size:'3.15 feet',material:'Black stone'}).expect(201)).body.data;
  supplier=(await call('post','suppliers').send({name:'Supplier',phone:'9876543211'}).expect(201)).body.data;
});
after(async()=>{await f?.pg.close();});
function call(method:'get'|'post'|'patch'|'delete',path='orders',app=f.app) {
  return request(app)[method]('/api/v1/'+path).set('Cookie',adminCookie).set('Origin',origin).set('X-CSRF-Token',csrf);
}
function body(extra:Body={}) {return {customer_id:customer.id,design_id:design.id,supplier_id:supplier.id,
  buying_price:'7000',selling_price:'10000',order_date:'2026-10-01',expected_delivery_date:'2026-10-10',...extra};}
async function create(extra:Body={}) {return (await call('post').send(body(extra)).expect(201)).body.data as Body;}
async function status(row:Body,value:string,code=200) {
  return call('post','orders/'+row.id+'/status').send({order_status:value,version:row.version,reason:'Test status change'}).expect(code);
}

test('database allocates 1001, unique subsequent numbers and immutable identifiers',async()=>{
  const a=await create(),b=await create();
  assert.equal(a.order_number,'1001');assert.equal(b.order_number,'1002');assert.equal(a.order_status,'NEW');
  assert.equal(a.created_by,adminId);assert.equal(a.updated_by,adminId);assert.equal(a.version,1);
  assert.equal(a.buying_price,'7000.00');assert.equal(a.profit,'3000.00');assert.equal(a.balance_amount,'10000.00');
  assert.equal(a.advance_amount,'0.00');assert.ok(a.created_at && a.updated_at);
  const delivery=await f.db.query<{delivery_status:string}>('SELECT delivery_status FROM divyashilla.deliveries WHERE order_id=$1',[a.id]);
  assert.equal(delivery.rows[0]!.delivery_status,'NOT_ASSIGNED');
  await assert.rejects(f.db.query('UPDATE divyashilla.orders SET order_number=9999 WHERE id=$1',[a.id]));
  const read=await call('get','orders/'+a.id).expect(200);assert.equal(read.body.data.order_number,a.order_number);
});

test('snapshots persist through master changes, including owned image and exact design size',async()=>{
  const c=(await call('post','customers').send({name:'Snapshot customer',phone:'9876543212',city:'Satara',address:'Old address'}).expect(201)).body.data;
  const d=(await call('post','designs').send({design_number:'SNAP',design_name:'Original design',size:'3.15 feet',material:'Stone'}).expect(201)).body.data;
  const image=await f.db.query<{id:string}>(`INSERT INTO divyashilla.files(blob_key,original_name,mime_type,size_bytes,category,state,design_id,uploaded_by)
    VALUES ('snapshot-image','photo.png','image/png',20,'DESIGN_IMAGE','ACTIVE',$1,$2) RETURNING id`,[d.id,adminId]);
  await call('patch','designs/'+d.id).send({image_file_id:image.rows[0]!.id}).expect(200);
  const row=await create({customer_id:c.id,design_id:d.id});
  assert.equal(row.delivery_name,'Snapshot customer');assert.equal(row.design_image_file_id,image.rows[0]!.id);
  await call('patch','customers/'+c.id).send({name:'Renamed',address:'New address'}).expect(200);
  await call('patch','designs/'+d.id).send({design_name:'Changed design',size:'6 feet',image_file_id:null}).expect(200);
  const saved=(await call('get','orders/'+row.id).expect(200)).body.data;
  assert.equal(saved.delivery_name,'Snapshot customer');assert.equal(saved.delivery_address,'Old address');
  assert.equal(saved.design_name_snapshot,'Original design');assert.equal(saved.size_snapshot,'3.15 feet');
  assert.equal(saved.design_image_file_id,image.rows[0]!.id);
});

test('New relinking refreshes snapshots; delivery overrides survive ordinary updates',async()=>{
  const c=(await call('post','customers').send({name:'Replacement',phone:'9876543213',city:'Mumbai'}).expect(201)).body.data;
  const d=(await call('post','designs').send({design_number:'RELINK',design_name:'New design',size:'4 feet',material:'Marble'}).expect(201)).body.data;
  let row=await create({delivery_name:'Recipient',delivery_phone:'+91 (98765) 43210',delivery_address:'Alternate'});
  assert.equal(row.delivery_phone,'+919876543210');
  row=(await call('patch','orders/'+row.id).send({version:row.version,additional_work:'Engraving'}).expect(200)).body.data;
  assert.equal(row.delivery_name,'Recipient');assert.equal(row.delivery_address,'Alternate');
  row=(await call('patch','orders/'+row.id).send({version:row.version,customer_id:c.id,design_id:d.id,delivery_city:'Thane'}).expect(200)).body.data;
  assert.equal(row.delivery_name,'Replacement');assert.equal(row.delivery_address,null);assert.equal(row.delivery_city,'Thane');
  assert.equal(row.design_name_snapshot,'New design');assert.equal(row.material_snapshot,'Marble');
  row=(await status(row,'IN_WORK')).body.data;
  await call('patch','orders/'+row.id).send({version:row.version,customer_id:customer.id}).expect(409);
});

test('active references required; existing orders remain readable after deactivation',async()=>{
  for (const path of ['customers','designs','suppliers']) {
    const target=path==='customers'?customer:path==='designs'?design:supplier;
    await call('post',path+'/'+target.id+'/deactivate').send({reason:'Test'}).expect(200);
    await call('post').send(body({[path==='customers'?'customer_id':path==='designs'?'design_id':'supplier_id']:target.id})).expect(422);
    await call('post',path+'/'+target.id+'/reactivate').send({reason:'Test'}).expect(200);
  }
  for (const field of ['customer_id','design_id','supplier_id']) await call('post').send(body({[field]:randomUUID()})).expect(422);
  const row=await create();
  await call('post','customers/'+customer.id+'/deactivate').send({reason:'Test'}).expect(200);
  await call('get','orders/'+row.id).expect(200);
  await call('patch','orders/'+row.id).send({version:1,additional_work:'Still editable'}).expect(200);
  await call('post','customers/'+customer.id+'/reactivate').send({reason:'Test'}).expect(200);
});

test('order validation rejects unsafe money, invalid dates, unknown fields and actor/snapshot spoofing',async()=>{
  for (const value of [-1,100,'-1','NaN','Infinity','1.001','01','1e4','1000000000000']) await call('post').send(body({selling_price:value})).expect(400);
  for (const date of ['2026-02-30','2026-10-01T00:00:00Z','01-10-2026']) await call('post').send(body({order_date:date})).expect(400);
  for (const field of ['order_number','order_status','created_by','updated_by','version','profit','design_name_snapshot','driver_number','assigned_delivery_user_id']) {
    await call('post').send(body({[field]:'spoof'})).expect(400);
  }
  await call('post').send(body({advance_amount:'10000.01'})).expect(422);
  await call('post').send(body({expected_delivery_date:'2026-09-30'})).expect(422);
  await call('post').send(body({delivery_name:'',delivery_phone:'abc'})).expect(400);
  await call('post').send(body({customer_id:null})).expect(400);
  const row=await create({advance_amount:'1000.10'});
  assert.equal(row.balance_amount,'10000.00'); // Agreed advance is not a receipt.
  await call('patch','orders/'+row.id).send({selling_price:'9999'}).expect(400);
  await call('patch','orders/'+row.id).send({version:1}).expect(400);
  await call('patch','orders/'+row.id).send({version:1,selling_price:'500'}).expect(422);
  await call('patch','orders/'+row.id).send({version:1,expected_delivery_date:'2026-09-30'}).expect(422);
});

test('optimistic versions prevent overwrites; no-op updates preserve version, timestamp and log count',async()=>{
  const row=await create();
  const saved=(await call('patch','orders/'+row.id).send({version:1,selling_price:'11000.25'}).expect(200)).body.data;
  assert.equal(saved.version,2);assert.equal(saved.order_number,row.order_number);assert.equal(saved.created_at,row.created_at);
  await call('patch','orders/'+row.id).send({version:1,additional_work:'Stale'}).expect(409);
  await status(row,'IN_WORK',409);
  const noop=(await call('patch','orders/'+row.id).send({version:2,selling_price:'11000.25'}).expect(200)).body.data;
  assert.equal(noop.version,2);assert.equal(noop.updated_at,saved.updated_at);
  const logs=await f.db.query<{action:string;before_data:Body;after_data:Body;actor_user_id:string;request_id:string}>(
    'SELECT * FROM divyashilla.activity_logs WHERE entity_id=$1 ORDER BY created_at',[row.id]);
  assert.deepEqual(logs.rows.map(r=>r.action),['ORDER_CREATED','ORDER_UPDATED']);
  assert.equal(logs.rows[1]!.before_data.selling_price,'10000.00');assert.equal(logs.rows[1]!.after_data.selling_price,'11000.25');
  assert.ok(logs.rows.every(r=>r.actor_user_id===adminId && r.request_id));
});

test('status progression requires work details, disallows skipping/backward moves, synchronizes delivery',async()=>{
  let row=await create({supplier_id:null,buying_price:null});
  await status(row,'IN_WORK',409);await status(row,'READY_FOR_DELIVERY',409);await status(row,'DELIVERED',409);
  row=(await call('patch','orders/'+row.id).send({version:1,supplier_id:supplier.id,buying_price:'7000'}).expect(200)).body.data;
  row=(await status(row,'IN_WORK')).body.data;
  await status(row,'NEW',409);
  row=(await status(row,'READY_FOR_DELIVERY')).body.data;
  assert.equal((await f.db.query<{delivery_status:string}>('SELECT delivery_status FROM divyashilla.deliveries WHERE order_id=$1',[row.id])).rows[0]!.delivery_status,'READY_FOR_DELIVERY');
  await status(row,'DELIVERED',409);
  // Setup preexisting dispatch using SQL: Phase 3 deliberately provides no driver-entry API.
  await f.db.query(`UPDATE divyashilla.deliveries SET driver_number='9876543210',driver_or_bus_name='Test bus',delivery_status='SENT' WHERE order_id=$1`,[row.id]);
  row=(await status(row,'DELIVERED')).body.data;
  assert.equal(row.order_status,'DELIVERED');assert.match(row.actual_delivery_date,/^\d{4}-\d{2}-\d{2}$/);
  const delivered=(await f.db.query<{delivery_status:string;delivered_at:unknown;updated_by:string}>('SELECT * FROM divyashilla.deliveries WHERE order_id=$1',[row.id])).rows[0]!;
  assert.equal(delivered.delivery_status,'DELIVERED');assert.ok(delivered.delivered_at);assert.equal(delivered.updated_by,adminId);
  await call('patch','orders/'+row.id).send({version:row.version,selling_price:'12000'}).expect(409);
  await status(row,'CANCELLED',409);
  const logs=await f.db.query<{reason:string;after_data:Body}>('SELECT * FROM divyashilla.activity_logs WHERE entity_id=$1 AND action=$2',[row.id,'ORDER_STATUS_CHANGED']);
  assert.equal(logs.rows.length,3);assert.equal(logs.rows[2]!.after_data.delivery_status,'DELIVERED');assert.equal(logs.rows[2]!.reason,'Test status change');
});

test('cancellation requires reason, preserves history and closes orders; Sent cancellation is blocked',async()=>{
  for (const stage of ['NEW','IN_WORK','READY_FOR_DELIVERY']) {
    let row=await create();
    if (stage!=='NEW') row=(await status(row,'IN_WORK')).body.data;
    if (stage==='READY_FOR_DELIVERY') row=(await status(row,'READY_FOR_DELIVERY')).body.data;
    await call('post','orders/'+row.id+'/status').send({version:row.version,order_status:'CANCELLED',reason:' '}).expect(400);
    row=(await status(row,'CANCELLED')).body.data;
    await status(row,'NEW',409);
    await call('patch','orders/'+row.id).send({version:row.version,additional_work:'Changed'}).expect(409);
    await call('get','orders/'+row.id).expect(200);
  }
  let sent=await create();sent=(await status(sent,'IN_WORK')).body.data;sent=(await status(sent,'READY_FOR_DELIVERY')).body.data;
  await f.db.query(`UPDATE divyashilla.deliveries SET driver_number='9876543210',driver_or_bus_name='Bus',delivery_status='SENT' WHERE order_id=$1`,[sent.id]);
  await status(sent,'CANCELLED',409);
});

test('list searches literal text, filters linked IDs/status/date/number and paginates deterministically',async()=>{
  const row=await create({delivery_name:'Search%_marker',order_date:'2026-11-01',expected_delivery_date:null});
  const found=await call('get').query({q:'%_marker'}).expect(200);assert.equal(found.body.meta.total,1);assert.equal(found.body.data[0].id,row.id);
  const filtered=await call('get').query({order_number:row.order_number,customer_id:customer.id,design_id:design.id,supplier_id:supplier.id,
    order_status:'NEW',date_from:'2026-11-01',date_to:'2026-11-01'}).expect(200);assert.equal(filtered.body.meta.total,1);
  assert.equal((await call('get').query({order_number:row.order_number,order_status:'CANCELLED'}).expect(200)).body.meta.total,0);
  const first=await call('get').query({limit:'1',sort_order:'asc'}).expect(200),second=await call('get').query({limit:'1',page:'2',sort_order:'asc'}).expect(200);
  assert.equal(first.body.data[0].order_number,'1001');assert.notEqual(first.body.data[0].id,second.body.data[0].id);
  assert.ok(first.body.meta.total_pages>1);
  assert.equal((await call('get').query({q:"' OR 1=1 --"}).expect(200)).body.meta.total,0);
  for (const query of [{sort_by:'selling_price;drop table orders'},{limit:'101'},{page:'0'},{order_number:'9223372036854775808'},
    {order_status:'Ready'},{customer_id:'bad'},{unknown:'x'},{date_from:'2026-11-02',date_to:'2026-11-01'}]) await call('get').query(query).expect(400);
});

test('every order endpoint is ADMIN-only; anonymous, CSRF, malformed IDs and missing records are handled',async()=>{
  const id=randomUUID();
  for (const [method,path] of [['get','orders'],['get','orders/'+id],['post','orders'],['patch','orders/'+id],['post','orders/'+id+'/status']] as const) {
    await request(f.app)[method]('/api/v1/'+path).set('Origin',origin).send({}).expect(401);
    await request(f.app)[method]('/api/v1/'+path).set('Origin',origin).set('Cookie',deliveryCookie).set('X-CSRF-Token',deliveryCsrf).send({}).expect(403);
  }
  for (const [method,path,payload] of [['post','orders',body()],['patch','orders/'+id,{version:1,additional_work:'x'}],['post','orders/'+id+'/status',{version:1,order_status:'IN_WORK',reason:'x'}]] as const) {
    await request(f.app)[method]('/api/v1/'+path).set('Cookie',adminCookie).set('Origin',origin).send(payload).expect(403);
    await call(method,path).set('Origin','https://untrusted.example').send(payload).expect(403);
  }
  await call('get','orders/bad').expect(400);await call('get','orders/'+id).expect(404);
  await call('patch','orders/'+id).send({version:1,additional_work:'x'}).expect(404);
  await call('post','orders/'+id+'/status').send({version:1,order_status:'IN_WORK',reason:'x'}).expect(404);
  await call('delete','orders/'+id).expect(404);
});

test('audit failures roll back order insert plus delivery, edits and both status changes',async()=>{
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    if (sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated audit failure');
    return tx.query(sql,values);
  }}))};
  const app=createApp(failing,config);
  const count=async(table:string)=>Number((await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.'+table)).rows[0]!.n);
  const beforeOrders=await count('orders'),beforeDeliveries=await count('deliveries');
  await call('post','orders',app).send(body()).expect(500);
  assert.equal(await count('orders'),beforeOrders);assert.equal(await count('deliveries'),beforeDeliveries);
  let row=await create();
  await call('patch','orders/'+row.id,app).send({version:1,additional_work:'Must rollback'}).expect(500);
  assert.equal((await call('get','orders/'+row.id).expect(200)).body.data.version,1);
  row=(await status(row,'IN_WORK')).body.data;
  await call('post','orders/'+row.id+'/status',app).send({version:row.version,order_status:'READY_FOR_DELIVERY',reason:'Test'}).expect(500);
  assert.equal((await call('get','orders/'+row.id).expect(200)).body.data.order_status,'IN_WORK');
  assert.equal((await f.db.query<{delivery_status:string}>('SELECT delivery_status FROM divyashilla.deliveries WHERE order_id=$1',[row.id])).rows[0]!.delivery_status,'NOT_ASSIGNED');
  row=(await status(row,'READY_FOR_DELIVERY')).body.data;
  await f.db.query(`UPDATE divyashilla.deliveries SET driver_number='9876543210',driver_or_bus_name='Bus',delivery_status='SENT' WHERE order_id=$1`,[row.id]);
  await call('post','orders/'+row.id+'/status',app).send({version:row.version,order_status:'DELIVERED',reason:'Test'}).expect(500);
  assert.equal((await call('get','orders/'+row.id).expect(200)).body.data.order_status,'READY_FOR_DELIVERY');
  const dispatch=(await f.db.query<{delivery_status:string;delivered_at:unknown}>('SELECT * FROM divyashilla.deliveries WHERE order_id=$1',[row.id])).rows[0]!;
  assert.equal(dispatch.delivery_status,'SENT');assert.equal(dispatch.delivered_at,null);
  const last=await create();assert.ok(BigInt(last.order_number)>1001n); // Failed inserts may leave sequence gaps.
});

test('existing receipt history guards relinking and price reductions without adding payment APIs',async()=>{
  const row=await create();
  await f.db.query(`INSERT INTO divyashilla.customer_payments(order_id,amount,direction,purpose,payment_date,payment_method,received_by,processed_by)
    VALUES ($1,9000,'RECEIPT','ADVANCE','2026-10-01','CASH',$2,$2)`,[row.id,adminId]);
  await call('patch','orders/'+row.id).send({version:1,selling_price:'8000'}).expect(409);
  await call('patch','orders/'+row.id).send({version:1,supplier_id:null}).expect(409);
  const read=(await call('get','orders/'+row.id).expect(200)).body.data;assert.equal(read.balance_amount,'1000.00');
});

test('draft defaults, exact maximum money and merged-field checks are respected',async()=>{
  const minimal=(await call('post').send({customer_id:customer.id,design_id:design.id,selling_price:'999999999999.99'}).expect(201)).body.data;
  assert.match(minimal.order_date,/^\d{4}-\d{2}-\d{2}$/);assert.equal(minimal.supplier_id,null);
  assert.equal(minimal.buying_price,null);assert.equal(minimal.profit,null);assert.equal(minimal.selling_price,'999999999999.99');
  await call('patch','orders/'+minimal.id).send({version:1,buying_price:'0',supplier_id:supplier.id}).expect(200);
  const row=await create();
  await call('patch','orders/'+row.id).send({version:1,order_date:'2026-11-01'}).expect(422);
  const working=(await status(row,'IN_WORK')).body.data;
  await call('patch','orders/'+row.id).send({version:working.version,buying_price:null}).expect(409);
  const noop=(await status(working,'IN_WORK')).body.data;assert.equal(noop.version,working.version);
});

test('read profit aggregates existing expenses separately from receipt totals',async()=>{
  const row=await create();
  await f.db.query(`INSERT INTO divyashilla.order_expenses(order_id,category,amount,expense_date,note,created_by)
    VALUES ($1,'DELIVERY',250,'2026-10-01','Transport',$2),($1,'OTHER',100,'2026-10-01','Packing',$2)`,[row.id,adminId]);
  const saved=(await call('get','orders/'+row.id).expect(200)).body.data;
  assert.equal(saved.delivery_expense,'250.00');assert.equal(saved.other_expense,'100.00');assert.equal(saved.profit,'2650.00');
});
