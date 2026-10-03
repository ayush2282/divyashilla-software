import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { mkdtemp,readFile,readdir,rm,stat,writeFile,symlink,chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/database.js';
import type { PrivateStorage } from '../src/storage/types.js';
import { localStorage } from '../src/storage/local.js';
import { azureBlobStorage,type AzureContainerPort } from '../src/storage/azure-blob.js';
import { MAX_FILE_BYTES } from '../src/modules/files/validation.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { cookie,config,fixture,origin,testPassword } from './helpers.js';

type Body=Record<string,any>;
type User={id:string;cookie:string;csrf:string};
let f:Awaited<ReturnType<typeof fixture>>,app:ReturnType<typeof createApp>,admin:User,tanaji:User,other:User;
let storage:PrivateStorage,directory:string,designId:string,orderId:string,foreignOrderId:string,deliveryId:string,customerPaymentId:string,supplierPaymentId:string,expenseId:string;
let JPEG:Buffer,PNG:Buffer,WEBP:Buffer;
const PDF=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
before(async()=>{
  f=await fixture();directory=await mkdtemp(join(tmpdir(),'divyashilla-files-'));storage=localStorage(directory);await storage.initialize();app=createApp(f.db,config,storage);
  JPEG=await readFile('tests/fixtures/pixel.jpg');PNG=await readFile('tests/fixtures/pixel.png');WEBP=await readFile('tests/fixtures/pixel.webp');
  const users:User[]=[];
  for (const [username,role] of [['ayush','ADMIN'],['tanaji','DELIVERY'],['other','DELIVERY']] as const) {
    const id=(await provisionUser(f.db,{name:username,username,role,password:testPassword})).id;
    await f.db.query('UPDATE divyashilla.users SET must_change_password=false WHERE id=$1',[id]);
    const res=await request(app).post('/api/v1/auth/login').set('Origin',origin).send({username,password:testPassword}).expect(200);
    users.push({id,cookie:cookie(res),csrf:res.body.csrfToken});
  }
  [admin,tanaji,other]=users as [User,User,User];
  const customer=(await call('post','customers',admin).send({name:'Customer',phone:'9876543210',city:'Pune'}).expect(201)).body.data.id;
  designId=(await call('post','designs',admin).send({design_number:'FILE-1',design_name:'Stone',size:'3.15 feet',material:'Granite'}).expect(201)).body.data.id;
  const supplier=(await call('post','suppliers',admin).send({name:'Supplier',phone:'9876543211'}).expect(201)).body.data.id;
  for (const user of [tanaji,other]) {
    let order=(await call('post','orders',admin).send({customer_id:customer,design_id:designId,supplier_id:supplier,buying_price:'700',selling_price:'1000'}).expect(201)).body.data;
    for (const status of ['IN_WORK','READY_FOR_DELIVERY']) order=(await call('post','orders/'+order.id+'/status',admin).send({version:order.version,order_status:status,reason:'Ready'}).expect(200)).body.data;
    const id=(await f.db.query<{id:string}>('SELECT id FROM divyashilla.deliveries WHERE order_id=$1',[order.id])).rows[0]!.id;
    await call('post','deliveries/'+id+'/assign',admin).send({version:order.version,assigned_delivery_user_id:user.id,reason:'Assigned'}).expect(200);
    if (user===tanaji) {orderId=order.id;deliveryId=id;}else foreignOrderId=order.id;
  }
  customerPaymentId=(await call('post','customer-payments',admin).set('Idempotency-Key',randomUUID()).send({order_id:orderId,amount:'100',direction:'RECEIPT',purpose:'ADVANCE',payment_date:'2026-10-01',payment_method:'CASH'}).expect(201)).body.data.id;
  supplierPaymentId=(await call('post','supplier-payments',admin).set('Idempotency-Key',randomUUID()).send({supplier_id:supplier,amount:'100',direction:'PAYMENT',payment_date:'2026-10-01',payment_method:'CASH'}).expect(201)).body.data.id;
  expenseId=(await call('post','order-expenses',admin).set('Idempotency-Key',randomUUID()).send({order_id:orderId,amount:'10',category:'OTHER',expense_date:'2026-10-01'}).expect(201)).body.data.id;
});
after(async()=>{await f?.pg.close();await rm(directory,{recursive:true,force:true});});
function call(method:'get'|'post'|'patch'|'delete',path:string,user=admin,target=app) {
  return request(target)[method]('/api/v1/'+path).set('Cookie',user.cookie).set('Origin',origin).set('X-CSRF-Token',user.csrf);
}
function upload(input:Body,bytes=PNG,mime='image/png',name='photo.png',user=admin,target=app) {
  return call('post','files',user,target).query(input).set('Content-Type',mime).set('X-File-Name',encodeURIComponent(name)).send(bytes);
}
function download(id:string,user=admin,target=app) {
  return call('get','files/'+id+'/download',user,target).buffer(true).parse((res,callback)=>{
    const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>chunks.push(chunk));res.on('end',()=>callback(null,Buffer.concat(chunks)));res.on('error',callback);
  });
}
function privateMetadata(body:Body) {
  assert.equal('blob_key' in body,false);assert.equal('storage_path' in body,false);assert.equal('public_url' in body,false);
  assert.equal(body.download_path,'/api/v1/files/'+body.id+'/download');
}
function safeDeliveryMetadata(body:Body) {
  privateMetadata(body);for (const field of ['buying_price','selling_price','profit','customer_payment_id','supplier_payment_id','expense_id','uploaded_by','design_id']) assert.equal(field in body,false);
}

test('ADMIN uploads every supported format and category; metadata and binary downloads stay private',async()=>{
  for (const [bytes,mime,name] of [[JPEG,'image/jpeg','photo.jpg'],[PNG,'image/png','photo.png'],[WEBP,'image/webp','photo.webp'],[PDF,'application/pdf','document.pdf']] as const) {
    const res=await upload({category:'ORDER_DOCUMENT',order_id:orderId},bytes,mime,name).expect(201);const row=res.body.data;
    privateMetadata(row);assert.equal(row.state,'ACTIVE');assert.equal(row.size_bytes,String(bytes.length));assert.equal(row.uploaded_by,admin.id);assert.equal(res.headers.location,'/api/v1/files/'+row.id);
    const downloaded=await download(row.id).expect(200);assert.deepEqual(downloaded.body,bytes);assert.equal(downloaded.headers['content-type']!.split(';')[0],mime);
    assert.match(downloaded.headers['content-disposition']!,/^attachment;/);assert.equal(downloaded.headers['cache-control'],'no-store');assert.equal(downloaded.headers['x-content-type-options'],'nosniff');
    const read=await call('get','files/'+row.id).expect(200);privateMetadata(read.body.data);
  }
  for (const input of [{category:'DESIGN_IMAGE',design_id:designId},{category:'ORDER_PRODUCT_IMAGE',order_id:orderId},
    {category:'CUSTOMER_PAYMENT_DOCUMENT',customer_payment_id:customerPaymentId},{category:'SUPPLIER_PAYMENT_DOCUMENT',supplier_payment_id:supplierPaymentId},
    {category:'EXPENSE_DOCUMENT',expense_id:expenseId}]) {
    const row=(await upload(input).expect(201)).body.data;
    assert.equal(row.category,input.category);assert.equal((await download(row.id).expect(200)).body.length,PNG.length);
  }
});

test('DELIVERY can upload/read assigned order photos and documents, but not foreign or financial owners',async()=>{
  const photo=(await upload({category:'ORDER_PRODUCT_IMAGE',order_id:orderId},PNG,'image/png','Delivery photo.png',tanaji).expect(201)).body.data;
  safeDeliveryMetadata(photo);assert.equal((await download(photo.id,tanaji).expect(200)).body.length,PNG.length);
  const doc=(await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Delivery note.pdf',tanaji).expect(201)).body.data;
  safeDeliveryMetadata(doc);await call('get','files/'+doc.id,tanaji).expect(200);
  const foreign=(await upload({category:'ORDER_DOCUMENT',order_id:foreignOrderId},PDF,'application/pdf','Foreign.pdf').expect(201)).body.data;
  await download(foreign.id,tanaji).expect(404);await call('get','files/'+foreign.id,tanaji).expect(404);
  await upload({category:'ORDER_PRODUCT_IMAGE',order_id:foreignOrderId},PNG,'image/png','photo.png',tanaji).expect(404);
  await upload({category:'ORDER_DOCUMENT',order_id:randomUUID()},PDF,'application/pdf','Missing.pdf',tanaji).expect(404);
  for (const input of [{category:'DESIGN_IMAGE',design_id:designId},{category:'CUSTOMER_PAYMENT_DOCUMENT',customer_payment_id:customerPaymentId},
    {category:'SUPPLIER_PAYMENT_DOCUMENT',supplier_payment_id:supplierPaymentId},{category:'EXPENSE_DOCUMENT',expense_id:expenseId}]) {
    await upload(input,PNG,'image/png','Financial.png',tanaji).expect(403);
    const row=(await upload(input).expect(201)).body.data;await call('get','files/'+row.id,tanaji).expect(404);await download(row.id,tanaji).expect(404);
  }
});

test('DELIVERY design-image access follows the exact order snapshot, not all images on that design',async()=>{
  const image=(await upload({category:'DESIGN_IMAGE',design_id:designId}).expect(201)).body.data;
  await download(image.id,tanaji).expect(404);
  await call('patch','designs/'+designId).send({image_file_id:image.id}).expect(200);
  await download(image.id,tanaji).expect(404); // Existing orders did not rewrite their snapshots.
  await f.db.query('UPDATE divyashilla.orders SET design_image_file_id=$2 WHERE id=$1',[orderId,image.id]);
  const read=(await call('get','files/'+image.id,tanaji).expect(200)).body.data;safeDeliveryMetadata(read);
  await download(image.id,tanaji).expect(200);await download(image.id,other).expect(404);
  const listed=await call('get','files',tanaji).query({order_id:orderId,category:'DESIGN_IMAGE'}).expect(200);assert.equal(listed.body.meta.total,1);assert.equal(listed.body.data[0].id,image.id);
  const newer=(await upload({category:'DESIGN_IMAGE',design_id:designId}).expect(201)).body.data;
  await call('patch','designs/'+designId).send({image_file_id:newer.id}).expect(200);await download(newer.id,tanaji).expect(404);await download(image.id,tanaji).expect(200);
});

test('reassignment and order cancellation revoke file access; ADMIN retains historical access',async()=>{
  const photo=(await upload({category:'ORDER_PRODUCT_IMAGE',order_id:orderId}).expect(201)).body.data;
  let delivery=(await call('get','deliveries/'+deliveryId).expect(200)).body.data;
  await call('post','deliveries/'+deliveryId+'/assign').send({version:delivery.version,assigned_delivery_user_id:other.id,reason:'Reassigned'}).expect(200);
  await download(photo.id,tanaji).expect(404);await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Hidden.pdf',tanaji).expect(404);
  assert.equal((await call('get','files',tanaji).query({order_id:orderId}).expect(200)).body.meta.total,0);await download(photo.id,other).expect(200);
  delivery=(await call('get','deliveries/'+deliveryId).expect(200)).body.data;
  await call('post','deliveries/'+deliveryId+'/assign').send({version:delivery.version,assigned_delivery_user_id:tanaji.id,reason:'Return assignment'}).expect(200);
  // Isolated second order: cancellation does not damage other test fixtures.
  const foreign=(await upload({category:'ORDER_PRODUCT_IMAGE',order_id:foreignOrderId}).expect(201)).body.data;
  const order=(await call('get','orders/'+foreignOrderId).expect(200)).body.data;
  await call('post','orders/'+foreignOrderId+'/status').send({version:order.version,order_status:'CANCELLED',reason:'Cancelled'}).expect(200);
  await download(foreign.id,other).expect(404);await download(foreign.id).expect(200);
});

test('category/ownership/filename validation rejects mismatches, multiple owners and actor/blob spoofing',async()=>{
  const target=createApp(f.db,config,storage);
  for (const input of [{category:'DESIGN_IMAGE',order_id:orderId},{category:'ORDER_DOCUMENT',order_id:orderId,design_id:designId},
    {category:'ORDER_DOCUMENT',order_id:orderId,uploaded_by:tanaji.id},{category:'ORDER_DOCUMENT',order_id:orderId,blob_key:'../secret'},
    {category:'OTHER',order_id:orderId},{category:'ORDER_DOCUMENT',order_id:'bad'},{category:'ORDER_DOCUMENT',order_id:orderId,state:'ACTIVE'}]) await upload(input,PNG,'image/png','image.png',admin,target).expect(400);
  for (const name of ['../secret.png','folder\\secret.png','bad\u0000name.png','bad\r\nname.png',' ','x'.repeat(201)+'.png']) await upload({category:'ORDER_PRODUCT_IMAGE',order_id:orderId},PNG,'image/png',name,admin,target).expect(400);
  await upload({category:'ORDER_PRODUCT_IMAGE',order_id:randomUUID()},PNG,'image/png','image.png',admin,target).expect(404);
  await upload({category:'CUSTOMER_PAYMENT_DOCUMENT',customer_payment_id:expenseId},PNG,'image/png','image.png',admin,target).expect(404);
  await call('post','files',admin,target).query({category:'ORDER_DOCUMENT',order_id:orderId}).set('Content-Type','image/png').set('X-File-Name','%bad%').send(PNG).expect(400);
  const named=(await upload({category:'ORDER_PRODUCT_IMAGE',order_id:orderId},PNG,'image/png','तुळशी.png',admin,target).expect(201)).body.data;
  const response=await download(named.id,admin,target).expect(200);assert.match(response.headers['content-disposition']!,/filename\*=UTF-8/);
});

test('file signatures and extensions block unsupported/disguised content and PDFs in image categories',async()=>{
  const target=createApp(f.db,config,storage),input={category:'ORDER_DOCUMENT',order_id:orderId};
  for (const mime of ['text/html','image/svg+xml','image/gif','application/zip','application/octet-stream','multipart/form-data']) await upload(input,PNG,mime,'bad.png',admin,target).expect(415);
  await upload(input,Buffer.from('<script>alert(1)</script>'),'image/png','bad.png',admin,target).expect(415);
  await upload(input,JPEG,'image/png','bad.png',admin,target).expect(415);
  await upload(input,PNG,'image/png','wrong.pdf',admin,target).expect(400);
  await upload({category:'DESIGN_IMAGE',design_id:designId},PDF,'application/pdf','image.pdf',admin,target).expect(400);
  await upload({category:'ORDER_PRODUCT_IMAGE',order_id:orderId},PDF,'application/pdf','image.pdf',admin,target).expect(400);
  await upload(input,PNG.subarray(0,30),'image/png','truncated.png',admin,target).expect(415);
  const webp=Buffer.from(WEBP);webp.writeUInt32LE(1,4);await upload(input,webp,'image/webp','invalid.webp',admin,target).expect(415);
  await upload(input,Buffer.from('%PDF-1.4\nno end marker'),'application/pdf','invalid.pdf',admin,target).expect(415);
});

test('the API enforces the database 1..10485760 size rule, accepting exactly 10 MiB and rejecting larger/empty files',async()=>{
  const target=createApp(f.db,config,storage),input={category:'ORDER_DOCUMENT',order_id:orderId};
  assert.equal(MAX_FILE_BYTES,10485760);
  await upload(input,Buffer.alloc(0),'application/pdf','empty.pdf',admin,target).expect(400);
  const full=Buffer.alloc(MAX_FILE_BYTES,32);full.write('%PDF-1.4\n',0);full.write('\n%%EOF\n',full.length-7);
  const row=(await upload(input,full,'application/pdf','maximum.pdf',admin,target).expect(201)).body.data;
  assert.equal(row.size_bytes,'10485760');assert.equal((await download(row.id,admin,target).expect(200)).body.length,10485760);
  const filesBefore=(await readdir(directory)).length;await upload(input,Buffer.alloc(MAX_FILE_BYTES+1,32),'application/pdf','oversized.pdf',admin,target).expect(413);
  assert.equal((await readdir(directory)).length,filesBefore);
});

test('file lists filter/paginate safely and never reveal financial/private fields to DELIVERY',async()=>{
  const target=createApp(f.db,config,storage);
  const list=await call('get','files',tanaji,target).query({order_id:orderId,limit:'1',page:'2',sort_order:'asc'}).expect(200);
  assert.ok(list.body.meta.total>1);assert.equal(list.body.data.length,1);list.body.data.forEach(safeDeliveryMetadata);
  const adminList=await call('get','files',admin,target).query({customer_payment_id:customerPaymentId}).expect(200);assert.ok(adminList.body.meta.total>0);
  for (const query of [{customer_payment_id:customerPaymentId},{supplier_payment_id:supplierPaymentId},{expense_id:expenseId},{design_id:designId},{category:'CUSTOMER_PAYMENT_DOCUMENT'}]) await call('get','files',tanaji,target).query(query).expect(403);
  for (const query of [{limit:'101'},{page:'0'},{order_id:orderId,design_id:designId},{unknown:'x'},{category:'OTHER'},{sort_order:'desc;drop table'}]) await call('get','files',admin,target).query(query).expect(400);
});

test('PENDING/DELETED file rows cannot be read/downloaded by either role',async()=>{
  for (const state of ['PENDING','DELETED']) {
    const row=(await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Hidden.pdf').expect(201)).body.data;
    await f.db.query('UPDATE divyashilla.files SET state=$2 WHERE id=$1',[row.id,state]);
    for (const user of [admin,tanaji]) {await call('get','files/'+row.id,user).expect(404);await download(row.id,user).expect(404);}
  }
});

test('every file endpoint requires login and uploads enforce CSRF/origin before processing bytes',async()=>{
  const target=createApp(f.db,config,storage),id=randomUUID(),input={category:'ORDER_PRODUCT_IMAGE',order_id:orderId};
  for (const path of ['files','files/'+id,'files/'+id+'/download']) await request(target).get('/api/v1/'+path).expect(401);
  await request(target).post('/api/v1/files').set('Origin',origin).query(input).set('Content-Type','image/png').set('X-File-Name','photo.png').send(PNG).expect(401);
  await request(target).post('/api/v1/files').set('Origin',origin).set('Cookie',tanaji.cookie).query(input).set('Content-Type','image/png').set('X-File-Name','photo.png').send(PNG).expect(403);
  await upload(input,PNG,'image/png','photo.png',tanaji,target).set('Origin','https://bad.example').expect(403);
  await call('get','files/bad',admin,target).expect(400);await call('get','files/'+id,admin,target).expect(404);
  await download(id,admin,target).expect(404);await call('delete','files/'+id,admin,target).expect(404);
  await call('patch','files/'+id,admin,target).send({state:'ACTIVE'}).expect(404);
});


test('required upload auditing rolls back metadata and removes complete private bytes',async()=>{
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    if (sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated file audit failure');return tx.query(sql,values);
  }}))};
  const target=createApp(failing,config,storage);
  const before=(await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.files')).rows[0]!.n;
  const objects=await readdir(directory);
  await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Must rollback.pdf',admin,target).expect(500);
  assert.equal((await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.files')).rows[0]!.n,before);
  assert.deepEqual(await readdir(directory),objects);
});

test('audit failure prevents download bytes while retaining the valid file and metadata',async()=>{
  const row=(await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Keep.pdf').expect(201)).body.data;
  const failing:Database={...f.db,transaction:work=>f.db.transaction(tx=>work({query:async(sql,values)=>{
    if (sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated download audit failure');return tx.query(sql,values);
  }}))};
  const target=createApp(failing,config,storage);
  const failed=await call('get','files/'+row.id+'/download',tanaji,target).expect(500);assert.equal(failed.headers['content-type']!.startsWith('application/json'),true);
  assert.equal(failed.headers['content-disposition']!,undefined);await download(row.id,tanaji).expect(200);
  const logs=await f.db.query<{action:string;actor_user_id:string;after_data:Body}>('SELECT * FROM divyashilla.activity_logs WHERE entity_id=$1 ORDER BY created_at',[row.id]);
  assert.deepEqual(logs.rows.map(r=>r.action),['FILE_UPLOADED','FILE_DOWNLOAD_STARTED']);assert.equal(logs.rows[1]!.actor_user_id,tanaji.id);
  assert.equal('blob_key' in logs.rows[0]!.after_data,false);
});

test('write failure creates no ACTIVE metadata and missing/corrupt private objects return safe 503',async()=>{
  const failing:PrivateStorage={...storage,put:async()=>{throw new Error('Simulated disk failure');}};
  const target=createApp(f.db,config,failing),before=(await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.files')).rows[0]!.n;
  await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Fail.pdf',admin,target).expect(500);
  assert.equal((await f.db.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.files')).rows[0]!.n,before);
  const row=(await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Missing.pdf').expect(201)).body.data;
  const key=(await f.db.query<{blob_key:string}>('SELECT blob_key FROM divyashilla.files WHERE id=$1',[row.id])).rows[0]!.blob_key;
  await storage.delete(key);const missing=await call('get','files/'+row.id+'/download').expect(503);assert.equal(missing.body.error.code,'FILE_UNAVAILABLE');
  assert.equal(JSON.stringify(missing.body).includes(directory),false);
  const corrupt=(await upload({category:'ORDER_DOCUMENT',order_id:orderId},PDF,'application/pdf','Corrupt.pdf').expect(201)).body.data;
  const corruptKey=(await f.db.query<{blob_key:string}>('SELECT blob_key FROM divyashilla.files WHERE id=$1',[corrupt.id])).rows[0]!.blob_key;
  await writeFile(join(directory,corruptKey),'short');await call('get','files/'+corrupt.id+'/download').expect(503);
});

test('upload rechecks assignments and live role/activity after storage write; unauthorized bytes are cleaned',async()=>{
  const before=(await readdir(directory)).length;
  const changing:PrivateStorage={...storage,put:async(key,bytes,mime)=>{
    await storage.put(key,bytes,mime);const delivery=(await call('get','deliveries/'+deliveryId).expect(200)).body.data;
    await call('post','deliveries/'+deliveryId+'/assign').send({version:delivery.version,assigned_delivery_user_id:other.id,reason:'Changed during upload'}).expect(200);
  }};
  await upload({category:'ORDER_PRODUCT_IMAGE',order_id:orderId},PNG,'image/png','Revoked.png',tanaji,createApp(f.db,config,changing)).expect(404);
  assert.equal((await readdir(directory)).length,before);
  const delivery=(await call('get','deliveries/'+deliveryId).expect(200)).body.data;
  await call('post','deliveries/'+deliveryId+'/assign').send({version:delivery.version,assigned_delivery_user_id:tanaji.id,reason:'Restore'}).expect(200);
  const deactivating:PrivateStorage={...storage,put:async(key,bytes,mime)=>{await storage.put(key,bytes,mime);await f.db.query('UPDATE divyashilla.users SET is_active=false WHERE id=$1',[tanaji.id]);}};
  await upload({category:'ORDER_PRODUCT_IMAGE',order_id:orderId},PNG,'image/png','Inactive.png',tanaji,createApp(f.db,config,deactivating)).expect(401);
  await f.db.query('UPDATE divyashilla.users SET is_active=true WHERE id=$1',[tanaji.id]);assert.equal((await readdir(directory)).length,before);
});

test('a shared design snapshot does not let a DELIVERY order filter reveal a foreign order relationship',async()=>{
  const image=(await upload({category:'DESIGN_IMAGE',design_id:designId}).expect(201)).body.data;
  await f.db.query('UPDATE divyashilla.orders SET design_image_file_id=$2 WHERE id IN ($1,$3)',[orderId,image.id,foreignOrderId]);
  await download(image.id,tanaji).expect(200);
  const foreign=await call('get','files',tanaji).query({order_id:foreignOrderId}).expect(200);assert.equal(foreign.body.meta.total,0);
});

test('local adapter is private, immutable, rejects traversal/symlinks and does not expose objects statically',async()=>{
  const root=await mkdtemp(join(tmpdir(),'divyashilla-storage-')),local=localStorage(root),key=randomUUID();
  try {
    await local.initialize();await local.put(key,PNG,'image/png');
    assert.equal((await stat(root)).mode & 0o077,0);assert.equal((await stat(join(root,key))).mode & 0o077,0);
    await assert.rejects(local.put(key,PDF,'application/pdf'));assert.deepEqual(await readFile(join(root,key)),PNG);
    await assert.rejects(local.put('../outside',PNG,'image/png'));await assert.rejects(local.open('../outside'));await assert.rejects(local.delete('../outside'));
    const link=randomUUID();await symlink(join(root,key),join(root,link));await assert.rejects(local.open(link));
    await assert.rejects(local.put(link,PNG,'image/png'));assert.deepEqual(await readFile(join(root,key)),PNG);
    await call('get','files/'+key,admin).expect(404);await request(app).get('/var/private-files/'+key).expect(404);
    await chmod(root,0o755);await assert.rejects(local.initialize(),/owner-only/);await chmod(root,0o700);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('Azure-ready adapter uses exclusive private blobs and backend streams, with no cloud connection',async()=>{
  const objects=new Map<string,Buffer>();let publicAccess:string|undefined;let uploadedOptions:unknown;
  const container:AzureContainerPort={getProperties:async()=>({...(publicAccess?{blobPublicAccess:publicAccess}:{})}),getBlockBlobClient:key=>({
    uploadData:async(bytes,options)=>{uploadedOptions=options;if (objects.has(key)) throw new Error('Exists');objects.set(key,Buffer.from(bytes));},
    download:async()=>({readableStreamBody:Readable.from([objects.get(key)!]),contentLength:objects.get(key)?.length}),
    deleteIfExists:async()=>{objects.delete(key);}
  })};
  const azure=azureBlobStorage(container),key=randomUUID();await azure.initialize();await azure.put(key,PDF,'application/pdf');
  assert.deepEqual(uploadedOptions,{conditions:{ifNoneMatch:'*'},blobHTTPHeaders:{blobContentType:'application/pdf'}});
  const object=await azure.open(key),chunks:Buffer[]=[];for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));assert.deepEqual(Buffer.concat(chunks),PDF);
  await assert.rejects(azure.put(key,PDF,'application/pdf'));publicAccess='blob';await assert.rejects(azure.initialize(),/private/);await assert.rejects(azure.open(key),/private/);
  publicAccess=undefined;await azure.delete(key);assert.equal(objects.size,0);await assert.rejects(azure.open('../secret'));
});
