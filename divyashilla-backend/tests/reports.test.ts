import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/database.js';
import { encodeCsv } from '../src/modules/reports/csv.js';
import { reportService, MAX_EXPORT_ROWS } from '../src/modules/reports/service.js';
import { reportKinds } from '../src/modules/reports/validation.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { cookie,config,fixture,origin,testPassword } from './helpers.js';

type Body=Record<string,any>;
let f:Awaited<ReturnType<typeof fixture>>,adminId:string,adminCookie:string,deliveryCookie:string,csrf:string;
let customerId:string,designId:string,supplierId:string,otherSupplierId:string;
let a:Body,b:Body,c:Body,d:Body,e:Body,g:Body,h:Body;
before(async()=>{
  f=await fixture();
  adminId=(await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword})).id;
  await provisionUser(f.db,{name:'Tanaji',username:'tanaji',role:'DELIVERY',password:testPassword});
  await f.db.query('UPDATE divyashilla.users SET must_change_password=false');
  for(const username of ['ayush','tanaji']) {
    const response=await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username,password:testPassword}).expect(200);
    if(username==='ayush') {adminCookie=cookie(response);csrf=response.body.csrfToken;} else deliveryCookie=cookie(response);
  }
  customerId=(await post('customers',{name:'=SUM(1,2)',phone:'+919876543210',city:'Pune',address:'First line\nमराठी, "address"'})).id;
  designId=(await post('designs',{design_number:'RPT',design_name:'Tulsi "Stone", मराठी',size:'3 feet',material:'Stone'})).id;
  supplierId=(await post('suppliers',{name:'Supplier A',phone:'9876543210'})).id;
  otherSupplierId=(await post('suppliers',{name:'Supplier B',phone:'9876543211'})).id;
  a=await order({selling_price:'1000.10',buying_price:'700.05'});
  b=await order({selling_price:'500',buying_price:'200'});
  c=await order({selling_price:'900',buying_price:null,delivery_city:'Mumbai'});
  const receipt=async(amount:string,extra:Body={})=>post('customer-payments',{order_id:a.id,amount,payment_date:'2026-04-01',payment_method:'UPI',direction:'RECEIPT',purpose:'INSTALLMENT',...extra});
  await receipt('200.10');await receipt('100');await receipt('50.05',{direction:'REFUND',purpose:undefined});
  const voidReceipt=await receipt('120');await post('customer-payments/'+voidReceipt.id+'/void',{reason:'Receipt reversed'});
  await post('customer-payments',{order_id:b.id,amount:'500',payment_date:'2026-04-01',payment_method:'CASH',direction:'RECEIPT',purpose:'FINAL'});
  for(const [category,amount] of [['DELIVERY','40.01'],['DELIVERY','10.02'],['OTHER','23.04']] as const)
    await post('order-expenses',{order_id:a.id,category,amount,expense_date:'2026-04-02'});
  const voidExpense=await post('order-expenses',{order_id:a.id,category:'OTHER',amount:'111',expense_date:'2026-04-02'});
  await post('order-expenses/'+voidExpense.id+'/void',{reason:'Duplicate expense'});
  const supplierPayment=async(amount:string,allocated:string,direction='PAYMENT')=>post('supplier-payments',{
    supplier_id:supplierId,amount,direction,payment_date:'2026-04-01',payment_method:'BANK_TRANSFER',allocations:[{order_id:a.id,amount:allocated}]});
  await supplierPayment('500','400');await supplierPayment('50','40','REFUND');
  const voidSupplier=await supplierPayment('50','50');await post('supplier-payments/'+voidSupplier.id+'/void',{reason:'Supplier correction'});
  d=await order({order_date:'2026-02-01',supplier_id:otherSupplierId,selling_price:'800',buying_price:'300'});
  e=await order({order_date:'2026-02-02',supplier_id:otherSupplierId,selling_price:'200',buying_price:'100'});
  const delivered=await order({order_date:'2026-02-03',supplier_id:otherSupplierId,selling_price:'200',buying_price:'100'});
  g=await order({order_date:'2026-02-04',supplier_id:otherSupplierId,selling_price:'200',buying_price:'100'});
  for(const row of [d,e,delivered,g]) {
    await post('orders/'+row.id+'/status',{version:1,order_status:'IN_WORK',reason:'Start work'});
    await post('orders/'+row.id+'/status',{version:2,order_status:'READY_FOR_DELIVERY',reason:'Ready'});
  }
  for(const row of [e,delivered,g]) await post('deliveries/'+row.delivery_id+'/send',{
    version:3,driver_number:'9876543210',driver_or_bus_name:'Bus "Name", Pune'});
  await post('deliveries/'+delivered.delivery_id+'/deliver',{version:4});
  await post('deliveries/'+g.delivery_id+'/issue',{version:4,reason:'Road closed'});
  h=await order({supplier_id:otherSupplierId,selling_price:'600',buying_price:'400'});
  await post('orders/'+h.id+'/status',{version:1,order_status:'CANCELLED',reason:'Customer cancelled'});
  const monthlySupplier=(await post('suppliers',{name:'Monthly',phone:'9876543212'})).id;
  await order({order_date:undefined,supplier_id:monthlySupplier,selling_price:'20',buying_price:'10'});
});
after(async()=>{await f?.pg.close();});
function call(method:'get'|'post',path:string,app=f.app) {
  return request(app)[method]('/api/v1/'+path).set('Cookie',adminCookie).set('Origin',origin)
    .set('X-CSRF-Token',csrf).set('Idempotency-Key',randomUUID());
}
async function post(path:string,body:Body) {return (await call('post',path).send(body).expect(path.includes('/') ? 200 : 201)).body.data;}
async function order(extra:Body={}) {
  const result=await post('orders',{customer_id:customerId,design_id:designId,supplier_id:supplierId,
    order_date:'2026-01-15',buying_price:'100',selling_price:'200',...extra});
  result.delivery_id=(await f.db.query<{id:string}>('SELECT id FROM divyashilla.deliveries WHERE order_id=$1',[result.id])).rows[0]!.id;
  return result;
}
function report(kind:string,query:Body={},app=f.app) {return call('get','reports/'+kind,app).query(query);}
const january={date_from:'2026-01-01',date_to:'2026-01-31'};
async function exportLogs() {return (await f.db.query<{n:string}>("SELECT count(*)::text AS n FROM divyashilla.activity_logs WHERE entity_type='REPORT'")).rows[0]!.n;}

test('all six JSON and CSV routes require login and deny DELIVERY before query validation',async()=>{
  const app=createApp(f.db,config);
  for(const kind of reportKinds) for(const suffix of ['','/export']) {
    const url='/api/v1/reports/'+kind+suffix;
    await request(app).get(url).query({date_from:'invalid'}).expect(401);
    const response=await request(app).get(url).set('Cookie',deliveryCookie).query({date_from:'invalid'}).expect(403);
    assert.equal(response.body.data,undefined);assert.equal(response.text.includes('700.05'),false);
  }
});

test('orders report filters dates inclusively and keeps snapshot customer/design details',async()=>{
  const response=await report('orders',{date_from:'2026-01-15',date_to:'2026-01-15',city:'pUne',supplier_id:supplierId,design_id:designId}).expect(200);
  assert.equal(response.body.meta.total,2);
  assert.deepEqual(response.body.data.map((row:Body)=>row.order_id),[b.id,a.id]);
  const row=response.body.data[1];assert.equal(row.customer_name,'=SUM(1,2)');assert.equal(row.customer_phone,'+919876543210');
  assert.equal(row.design_name,'Tulsi "Stone", मराठी');assert.equal(row.size,'3 feet');assert.equal(typeof row.order_number,'string');
  assert.equal(row.order_date,'2026-01-15');assert.equal(row.selling_price,'1000.10');
});

test('posted-only financial totals net refunds and never multiply multiple receipts, expenses or allocations',async()=>{
  const response=await report('orders',{...january,supplier_id:supplierId,city:'Pune'}).expect(200);
  const row=response.body.data.find((row:Body)=>row.order_id===a.id);
  assert.equal(row.customer_net_received,'250.05');assert.equal(row.balance_amount,'750.05');
  assert.equal(row.delivery_expense,'50.03');assert.equal(row.other_expense,'23.04');assert.equal(row.profit,'226.98');
  assert.equal(row.supplier_net_paid,'360.00');assert.equal(row.supplier_balance_amount,'340.05');
  const summary=response.body.summary;
  assert.equal(summary.selling_price,'1500.10');assert.equal(summary.customer_net_received,'750.05');
  assert.equal(summary.profit,'526.98');assert.equal(summary.unpriced_orders,0);
});

test('profit report uses order_financials, omits cancelled by default and flags incomplete totals',async()=>{
  const response=await report('profit',january).expect(200);
  assert.equal(response.body.meta.total,3);assert.equal(response.body.summary.profit,null);
  assert.equal(response.body.summary.known_profit,'526.98');assert.equal(response.body.summary.unpriced_orders,1);
  const unknown=response.body.data.find((row:Body)=>row.order_id===c.id);
  assert.equal(unknown.buying_price,null);assert.equal(unknown.profit,null);
  const cancelled=await report('profit',{...january,order_status:'CANCELLED'}).expect(200);
  assert.equal(cancelled.body.meta.total,1);assert.equal(cancelled.body.data[0].profit,'200.00');
});

test('customer dues include only positive current balances for non-cancelled orders',async()=>{
  const response=await report('customer-dues',january).expect(200);
  assert.deepEqual(new Set(response.body.data.map((row:Body)=>row.order_id)),new Set([a.id,c.id]));
  assert.equal(response.body.summary.balance_amount,'1650.05');assert.equal(response.body.meta.total,2);
  assert.equal((await report('customer-dues',{...january,order_status:'CANCELLED'}).expect(200)).body.meta.total,0);
});

test('supplier rows distinguish order allocations from lifetime paid/unallocated funds and exclude VOID',async()=>{
  const response=await report('suppliers',{...january,supplier_id:supplierId}).expect(200);
  const row=response.body.data[0];assert.equal(row.orders_given,3);assert.equal(row.order_count,3);
  assert.equal(row.total_buying_cost,'900.05');assert.equal(row.paid_amount,'360.00');assert.equal(row.pending_amount,'540.05');
  assert.equal(row.lifetime_paid_amount,'450.00');assert.equal(row.unallocated_paid_amount,'90.00');
  assert.equal(row.lifetime_pending_amount,'450.05');assert.equal(row.lifetime_credit_amount,'0.00');
  assert.equal(row.unpriced_orders,1);assert.equal(row.lifetime_unpriced_orders,1);
});

test('supplier range selects orders but preserves later posted allocations and lifetime balance',async()=>{
  const response=await report('suppliers',{...january,supplier_id:otherSupplierId}).expect(200);
  const row=response.body.data[0];assert.equal(row.orders_given,1);assert.equal(row.total_buying_cost,'400.00');
  assert.equal(row.lifetime_buying_cost,'1000.00');assert.equal(row.pending_amount,'400.00');assert.equal(row.lifetime_pending_amount,'1000.00');
  // Cancelled supplier liabilities remain owed under the existing view.
  assert.equal(response.body.summary.order_count,1);
});

test('dashboard computes counts, current dues, posted profit and supplier pending amounts',async()=>{
  const response=await report('dashboard',january).expect(200),row=response.body.data;
  assert.equal(row.total_orders,4);assert.equal(row.cancelled_orders,1);assert.equal(row.payment_pending_orders,2);
  assert.equal(row.payment_pending_amount,'1650.05');assert.equal(row.sales,'2400.10');assert.equal(row.known_profit,'526.98');
  assert.equal(row.unpriced_orders,1);assert.equal(row.pending_delivery,0);assert.equal(row.monthly_sales,'0.00');
  assert.equal(row.supplier_payment_pending_amount,'1450.05');assert.equal(row.supplier_payment_pending_suppliers,2);
});

test('dashboard monthly sales and profit use the current India calendar month',async()=>{
  const row=(await report('dashboard').expect(200)).body.data;
  assert.equal(row.monthly_sales,'20.00');assert.equal(row.monthly_known_profit,'10.00');assert.equal(row.monthly_unpriced_orders,0);
  assert.equal(row.total_orders,9);assert.equal(row.pending_delivery,3);assert.equal(row.delivery_issues,1);
});

test('delivery report lists precisely the four operational statuses without financial columns',async()=>{
  const response=await report('deliveries',{date_from:'2026-02-01',date_to:'2026-02-28'}).expect(200);
  assert.equal(response.body.meta.total,4);
  for(const key of ['ready_for_delivery_count','sent_count','delivered_count','issue_count']) assert.equal(response.body.summary[key],1);
  for(const row of response.body.data) for(const key of ['selling_price','buying_price','profit','balance_amount','supplier_net_paid','other_expense'])
    assert.equal(row[key],undefined);
  const issue=await report('deliveries',{delivery_status:'ISSUE',supplier_id:otherSupplierId,city:'Pune'}).expect(200);
  assert.equal(issue.body.data[0].order_id,g.id);assert.equal(issue.body.meta.total,1);
  const delivered=await report('deliveries',{delivery_status:'DELIVERED'}).expect(200);
  assert.match(delivered.body.data[0].delivered_at,/^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test('all list reports paginate deterministically and summaries cover all filtered rows',async()=>{
  for(const kind of ['orders','profit','customer-dues','suppliers','deliveries']) {
    const whole=(await report(kind).expect(200)).body;
    const page=(await report(kind,{page:'2',limit:'1'}).expect(200)).body;
    assert.equal(page.data.length,1);assert.deepEqual(page.summary,whole.summary);
    assert.equal(page.meta.total,whole.meta.total);assert.equal(page.meta.total_pages,whole.meta.total);
    assert.deepEqual(page.data[0],whole.data[1]);
    const beyond=(await report(kind,{page:'100000',limit:'100'}).expect(200)).body;
    assert.equal(beyond.data.length,0);assert.equal(beyond.meta.total,whole.meta.total);
  }
});

test('empty reports return zero totals and valid pagination, with empty CSV header',async()=>{
  for(const kind of reportKinds) {
    const response=await report(kind,{date_from:'1990-01-01',date_to:'1990-01-02'}).expect(200);
    if(kind==='dashboard') assert.equal(response.body.data.total_orders,0);
    else {assert.equal(response.body.meta.total,0);assert.equal(response.body.meta.total_pages,0);assert.deepEqual(response.body.data,[]);}
  }
  const csv=await report('orders/export',{date_from:'1990-01-01',date_to:'1990-01-02'}).expect(200);
  assert.equal(csv.text.split('\r\n').length,2);assert.ok(csv.text.includes('"order_number"'));
});

test('invalid dates, ranges, UUIDs, enums, pagination, arrays and unsupported fields are rejected',async()=>{
  const app=createApp(f.db,config);
  for(const query of [{date_from:'2026-02-30'},{date_from:'0000-01-01'},{date_to:'bad'},
    {date_from:'2026-03-01',date_to:'2026-02-01'},{supplier_id:'bad'},{design_id:'bad'},
    {order_status:'new'},{city:' '},{city:'bad\u0000text'},{page:'0'},{page:'1.5'},{page:'100001'},
    {limit:'101'},{limit:'-1'},{sort_by:'profit'},{date_from:['2026-01-01','2026-01-02']},{include_void:'true'}])
    await report('orders',query,app).expect(400);
  await report('deliveries',{delivery_status:'NOT_ASSIGNED'},app).expect(400);
  await report('suppliers',{city:'Pune'},app).expect(400);
  await report('dashboard',{page:'1'},app).expect(400);
  await report('orders/export',{page:'1'},app).expect(400);
  await report('orders/export',{limit:'1'},app).expect(400);
  await report('orders/export',{date_from:'2026-02-30'},app).expect(400);
});

test('city filter is literal and parameterized, including SQL injection and wildcard text',async()=>{
  for(const city of ["Pune' OR TRUE --",'%','_']) assert.equal((await report('orders',{city}).expect(200)).body.meta.total,0);
});

test('CSV exports the complete filtered set and safely handles formulas, quotes, commas and Unicode',async()=>{
  const response=await report('orders/export',{...january,supplier_id:supplierId,city:'Pune'}).expect(200);
  assert.match(response.headers['content-type']!,/^text\/csv/);assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.headers['content-disposition'],'attachment; filename="divyashilla-orders.csv"');
  assert.ok(response.text.includes('"\'=SUM(1,2)"'));assert.ok(response.text.includes('"\'+919876543210"'));
  assert.ok(response.text.includes('Tulsi ""Stone"", मराठी'));assert.ok(response.text.includes('First line\nमराठी, ""address""'));
  assert.ok(response.text.includes('"1000.10"'));assert.ok(response.text.includes(a.order_number));assert.ok(response.text.includes(b.order_number));
});

test('every report exports CSV and delivery export omits financial columns',async()=>{
  for(const kind of reportKinds) {
    const response=await report(kind+'/export').expect(200);
    assert.ok(response.text.length>50);assert.match(response.headers['content-type']!,/^text\/csv/);
    if(kind==='deliveries') {assert.ok(response.text.includes('delivery_status'));assert.equal(response.text.includes('selling_price'),false);}
  }
});

test('CSV encoder neutralizes text formulas but preserves negative numeric profit',()=>{
  const text=encodeCsv([{name:' \t=1+1',profit:'-12.30'},{name:'@SUM(1)',profit:null},{name:'\rtext',profit:'0.00'}],
    [{key:'name'},{key:'profit',numeric:true}]);
  assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('"\' \t=1+1","-12.30"'));
  assert.ok(text.includes('"\'@SUM(1)",""'));assert.ok(text.includes('"\'\rtext"'));
  assert.throws(()=>encodeCsv([{profit:'=1'}],[{key:'profit',numeric:true}]));
});

test('ordinary report reads create no activity; exports record actor, filters and row count only',async()=>{
  const before=await exportLogs();for(const kind of reportKinds) await report(kind).expect(200);
  assert.equal(await exportLogs(),before);
  const response=await report('profit/export',{...january,city:'Pune'}).expect(200);
  const logs=await f.db.query<Body>("SELECT * FROM divyashilla.activity_logs WHERE entity_type='REPORT' ORDER BY created_at DESC LIMIT 1");
  const log=logs.rows[0]!;assert.equal(log.action,'REPORT_EXPORT_STARTED');assert.equal(log.actor_user_id,adminId);
  assert.equal(log.request_id,response.headers['x-request-id']);assert.equal(log.after_data.report_type,'profit');
  assert.equal(log.after_data.row_count,2);assert.equal(log.after_data.city,'Pune');assert.equal(log.after_data.date_from,january.date_from);
  assert.equal(log.entity_id,null);assert.equal(log.after_data.selling_price,undefined);assert.equal(log.after_data.customer_name,undefined);
});

test('audit failure prevents CSV bytes and leaves no export activity',async()=>{
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    if(sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated audit failure');return tx.query(sql,values);
  }}))};
  const app=createApp(failing,config),before=await exportLogs();
  const response=await report('orders/export',january,app).expect(500);
  assert.match(response.headers['content-type']!,/json/);assert.equal(response.headers['content-disposition'],undefined);
  assert.equal(response.text.includes('selling_price'),false);assert.equal(await exportLogs(),before);
  await report('orders',january,app).expect(200);
});

test('all report reads/exports use one repeatable-read transaction for their queries and audit',async()=>{
  const statements:string[]=[],tracked:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    statements.push(sql);return tx.query(sql,values);
  }}))};
  const service=reportService(tracked);
  for(const kind of reportKinds) {
    statements.length=0;await service.read(kind,{page:1,limit:1});assert.equal(statements[0],'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    statements.length=0;await service.export(kind,{}, {id:adminId,requestId:randomUUID()});
    assert.equal(statements[0],'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    assert.ok(statements.at(-1)!.includes('INSERT INTO divyashilla.activity_logs'));
  }
});

test('export limit is explicit and never truncates or audits an oversized result',async()=>{
  let logged=false;
  // A narrow adapter fault/volume fixture exercises the bound without 10,001 business inserts.
  const oversized:Database={...f.db,transaction:async work=>work({query:async<T extends object>(sql:string)=>{
    if(sql.includes('INSERT INTO divyashilla.activity_logs')) logged=true;
    if(sql.includes('SELECT * FROM report')) return {rows:Array.from({length:MAX_EXPORT_ROWS+1},()=>({})) as T[],rowCount:MAX_EXPORT_ROWS+1};
    return {rows:[] as T[],rowCount:0};
  }})};
  await assert.rejects(()=>reportService(oversized).export('orders',{}, {id:adminId,requestId:randomUUID()}),
    (error:Body)=>error.status===413 && error.code==='EXPORT_TOO_LARGE');
  assert.equal(logged,false);
});

test('maximum money remains exact and real negative profit is exported as a numeric cell',async()=>{
  const row=await order({order_date:'2030-05-01',buying_price:'999999999999.99',selling_price:'999999999999.98'});
  await post('order-expenses',{order_id:row.id,category:'OTHER',amount:'0.03',expense_date:'2030-05-02'});
  const filters={date_from:'2030-05-01',date_to:'2030-05-01'};
  const response=await report('profit',filters).expect(200);
  assert.equal(response.body.data[0].profit,'-0.04');assert.equal(response.body.summary.profit,'-0.04');
  assert.equal(response.body.summary.selling_price,'999999999999.98');
  const csv=await report('profit/export',filters).expect(200);
  assert.ok(csv.text.includes('"-0.04"'));assert.equal(csv.text.includes('"\'-0.04"'),false);
});

test('report/export authorization rechecks a changed session role and inactive account',async()=>{
  try {
    await f.db.query("UPDATE divyashilla.users SET role='DELIVERY' WHERE id=$1",[adminId]);
    await report('dashboard').expect(403);await report('orders/export').expect(403);
    await f.db.query("UPDATE divyashilla.users SET role='ADMIN',is_active=false WHERE id=$1",[adminId]);
    await report('dashboard').expect(401);await report('orders/export').expect(401);
  } finally {await f.db.query("UPDATE divyashilla.users SET role='ADMIN',is_active=true WHERE id=$1",[adminId]);}
});
