// Disposable test server only. Never reads .env or connects to business data.
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStorage } from '../../divyashilla-backend/src/storage/local.ts';
import { fixture,testPassword } from '../../divyashilla-backend/tests/helpers.ts';
import { createApp } from '../../divyashilla-backend/src/app.ts';
import { loadConfig } from '../../divyashilla-backend/src/config.ts';
import { provisionUser } from '../../divyashilla-backend/src/modules/users/provision.ts';
import { customerService } from '../../divyashilla-backend/src/modules/customers/service.ts';
import { designService } from '../../divyashilla-backend/src/modules/designs/service.ts';
import { supplierService } from '../../divyashilla-backend/src/modules/suppliers/service.ts';
import { deliveryService } from '../../divyashilla-backend/src/modules/delivery/service.ts';
import { orderService } from '../../divyashilla-backend/src/modules/orders/service.ts';
process.chdir(fileURLToPath(new URL('../../divyashilla-backend/',import.meta.url)));
const f=await fixture(),admin=await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword});
const tanaji=await provisionUser(f.db,{name:'Tanaji',username:'tanaji',role:'DELIVERY',password:testPassword});
await provisionUser(f.db,{name:'Second driver',username:'second',role:'DELIVERY',password:testPassword});
await f.db.query('UPDATE divyashilla.users SET must_change_password=false');
await provisionUser(f.db,{name:'First login',username:'temporary',role:'ADMIN',password:testPassword});
const actor={id:admin.id,requestId:randomUUID()};
let customerId:string|undefined;
for(let i=1;i<=25;i++) {
  const row=await customerService(f.db).create({name:'Sample customer '+String(i).padStart(2,'0'),phone:'9876543210',city:i%2?'Pune':'Kolhapur',address:'Sample address',notes:null},actor);
  customerId=row.id;
}
const design=await designService(f.db).create({design_number:'701',design_name:'Stone Tulsi Vrindavan',size:'4 feet',material:'Black stone',notes:null},actor);
const supplier=await supplierService(f.db).create({name:'Sample artisan',phone:'9876543211',city:'Kolhapur',address:null,notes:null},actor);
await orderService(f.db).create({customer_id:customerId!,design_id:design.id,supplier_id:supplier.id,buying_price:'24000.00',selling_price:'35000.00',advance_amount:'5250.00'},actor);
// Zero-value order fixtures preserve Phase 8 dashboard-value assertions.
for(let i=1;i<=12;i++) await orderService(f.db).create({customer_id:customerId!,design_id:design.id,supplier_id:supplier.id,buying_price:'0.00',selling_price:'0.00',delivery_name:'Pagination order '+i},actor);
const sent=await orderService(f.db).create({customer_id:customerId!,design_id:design.id,supplier_id:supplier.id,buying_price:'0.00',selling_price:'0.00',delivery_name:'Sent fixture recipient'},actor);
await orderService(f.db).changeStatus(sent.id,{version:1,order_status:'IN_WORK',reason:'Test work'},actor);
await orderService(f.db).changeStatus(sent.id,{version:2,order_status:'READY_FOR_DELIVERY',reason:'Test ready'},actor);
const delivery=(await f.db.query<{id:string}>('SELECT id FROM divyashilla.deliveries WHERE order_id=$1',[sent.id])).rows[0]!;
await deliveryService(f.db).send(delivery.id,{version:3,driver_number:'9876543210',driver_or_bus_name:'Test driver'}, {...actor,role:'ADMIN'});
// Assigned zero-price deliveries preserve earlier dashboard sales assertions.
for(let i=1;i<=12;i++){
  const row=await orderService(f.db).create({customer_id:customerId!,design_id:design.id,supplier_id:supplier.id,buying_price:'0',selling_price:'0',delivery_name:'Tanaji queue '+i,expected_delivery_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date())},actor);
  await orderService(f.db).changeStatus(row.id,{version:1,order_status:'IN_WORK',reason:'Fixture work'},actor);
  await orderService(f.db).changeStatus(row.id,{version:2,order_status:'READY_FOR_DELIVERY',reason:'Fixture ready'},actor);
  const d=(await f.db.query<{id:string}>('SELECT id FROM divyashilla.deliveries WHERE order_id=$1',[row.id])).rows[0]!;
  await deliveryService(f.db).assign(d.id,{version:3,assigned_delivery_user_id:tanaji.id,reason:'Fixture assignment'},{...actor,role:'ADMIN'});
}
const privateDirectory=await mkdtemp(join(tmpdir(),'divyashilla-phase11-files-'));
const storage=localStorage(privateDirectory);await storage.initialize();
const config=loadConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@localhost/test',CSRF_SECRET:'a'.repeat(64),ALLOWED_ORIGINS:'http://localhost:5173',PORT:'3180'});
// Each browser test gets fresh in-memory rate-limit counters. Every business
// request still runs through the unchanged application's security middleware.
let app=createApp(f.db,config,storage);
const server=createServer((req,res)=>{
  if(req.method==='POST'&&req.url==='/__test/reset-rate-limiters'){
    app=createApp(f.db,config,storage);res.writeHead(204);res.end();return;
  }
  app(req,res);
}).listen(3180,'127.0.0.1',()=>process.stdout.write('Disposable test backend ready\n'));
async function shutdown() {server.close();await f.pg.close();await rm(privateDirectory,{recursive:true,force:true});process.exit(0);}
process.on('SIGTERM',()=>{void shutdown();});process.on('SIGINT',()=>{void shutdown();});
