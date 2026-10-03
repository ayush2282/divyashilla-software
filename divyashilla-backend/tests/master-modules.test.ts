import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/database.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { cookie, config, fixture, origin, testPassword } from './helpers.js';

type Body = Record<string,unknown>;
const modules = [
  {path:'customers',entity:'CUSTOMER',label:'Customer',nameField:'name',sortField:'name',
    body:(name: string): Body => ({name,phone:'+91 (99999) 11111',city:'Pune',address:'Test address',notes:'Test notes'})},
  {path:'designs',entity:'DESIGN',label:'Design',nameField:'design_name',sortField:'design_name',
    body:(name: string): Body => ({design_number:'P2-'+randomUUID().slice(0,8),design_name:name,size:'3.5 feet',material:'Stone',notes:'Test notes'})},
  {path:'suppliers',entity:'SUPPLIER',label:'Supplier',nameField:'name',sortField:'name',
    body:(name: string): Body => ({name,phone:'+91 (99999) 22222',city:'Kolhapur',address:'Test address',notes:'Test notes'})}
] as const;

let f: Awaited<ReturnType<typeof fixture>>;
let adminId: string, adminCookie: string, adminCsrf: string, deliveryCookie: string, deliveryCsrf: string;
before(async () => {
  f = await fixture();
  adminId = (await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword})).id;
  await provisionUser(f.db,{name:'Tanaji',username:'tanaji',role:'DELIVERY',password:testPassword});
  await f.db.query('UPDATE divyashilla.users SET must_change_password = false');
  const admin = await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username:'ayush',password:testPassword}).expect(200);
  const delivery = await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username:'tanaji',password:testPassword}).expect(200);
  adminCookie = cookie(admin); adminCsrf = admin.body.csrfToken;
  deliveryCookie = cookie(delivery); deliveryCsrf = delivery.body.csrfToken;
});
after(async () => {await f?.pg.close();});

function call(method: 'get' | 'post' | 'patch' | 'delete',path: string,app = f.app) {
  return request(app)[method](path).set('Cookie',adminCookie).set('Origin',origin).set('X-CSRF-Token',adminCsrf);
}
async function create(module: typeof modules[number],name: string,extra: Body = {}) {
  return (await call('post','/api/v1/'+module.path).send({...module.body(name),...extra}).expect(201)).body.data;
}

for (const module of modules) {
  const base = '/api/v1/'+module.path;

  test(`${module.path}: create/read/patch/deactivate/reactivate and DELETE preserve history with audit`,async () => {
    const name = module.label+' CRUD';
    const response = await call('post',base).send(module.body(name)).expect(201);
    const row = response.body.data;
    assert.equal(response.headers.location,base+'/'+row.id);
    assert.equal(row.is_active,true);
    assert.equal(row.created_by,adminId);
    assert.equal(row.updated_by,adminId);
    assert.ok(row.created_at && row.updated_at);
    const read = await call('get',base+'/'+row.id).expect(200);
    assert.equal(read.body.data[module.nameField],name);
    const patch = await call('patch',base+'/'+row.id).send({notes:'Changed notes'}).expect(200);
    assert.equal(patch.body.data.notes,'Changed notes');
    assert.equal(patch.body.data[module.nameField],name);
    assert.equal(patch.body.data.created_at,row.created_at);
    assert.ok(new Date(patch.body.data.updated_at) >= new Date(row.updated_at));
    // Identical PATCH and repeated deactivate are harmless no-ops.
    const noop = await call('patch',base+'/'+row.id).send({notes:'Changed notes'}).expect(200);
    assert.equal(noop.body.data.updated_at,patch.body.data.updated_at);
    await call('post',base+'/'+row.id+'/deactivate').send({reason:'No longer used'}).expect(200);
    await call('post',base+'/'+row.id+'/deactivate').send({reason:'Repeated request'}).expect(200);
    const active = await call('get',base).query({q:name}).expect(200);
    assert.equal(active.body.meta.total,0);
    const inactive = await call('get',base).query({q:name,status:'inactive'}).expect(200);
    assert.equal(inactive.body.data[0].id,row.id);
    assert.equal((await call('get',base+'/'+row.id).expect(200)).body.data.is_active,false);
    assert.equal((await call('post',base+'/'+row.id+'/reactivate').send({reason:'Needed again'}).expect(200)).body.data.is_active,true);
    await call('delete',base+'/'+row.id).send({reason:'Keep historical record'}).expect(200);
    assert.equal((await call('get',base+'/'+row.id).expect(200)).body.data.is_active,false);
    const logs = await f.db.query<{action: string;actor_user_id: string;before_data: Body | null;after_data: Body;reason: string | null;request_id: string}>(
      'SELECT action,actor_user_id,before_data,after_data,reason,request_id FROM divyashilla.activity_logs WHERE entity_id = $1 ORDER BY created_at',[row.id]);
    assert.deepEqual(logs.rows.map(log => log.action),[module.entity+'_CREATED',module.entity+'_UPDATED',module.entity+'_DEACTIVATED',module.entity+'_REACTIVATED',module.entity+'_DEACTIVATED']);
    assert.ok(logs.rows.every(log => log.actor_user_id === adminId && log.request_id));
    assert.equal(logs.rows[1]!.before_data!.notes,'Test notes');
    assert.equal(logs.rows[1]!.after_data.notes,'Changed notes');
    assert.equal(logs.rows[2]!.reason,'No longer used');
  });

  test(`${module.path}: Tanaji and unauthenticated callers cannot use any CRUD route`,async () => {
    const id = randomUUID();
    await request(f.app).get(base).expect(401);
    await request(f.app).post(base).set('Origin',origin).send(module.body('Unauthorized')).expect(401);
    for (const [method,path,body] of [
      ['get',base,undefined],['get',base+'/'+id,undefined],['post',base,module.body('Forbidden')],
      ['patch',base+'/'+id,{notes:'Forbidden'}],['delete',base+'/'+id,{reason:'Forbidden'}],
      ['post',base+'/'+id+'/deactivate',{reason:'Forbidden'}],['post',base+'/'+id+'/reactivate',{reason:'Forbidden'}]
    ] as const) {
      let req = request(f.app)[method](path).set('Cookie',deliveryCookie).set('Origin',origin).set('X-CSRF-Token',deliveryCsrf);
      if (body) req = req.send(body);
      const denied = await req.expect(403);
      assert.equal(denied.body.error.code,'FORBIDDEN');
      assert.equal(denied.body.data,undefined);
    }
  });

  test(`${module.path}: strict field/query/UUID validation prevents invalid input and actor spoofing`,async () => {
    const id = randomUUID();
    await call('post',base).send({}).expect(400);
    await call('post',base).send({...module.body('Invalid actor'),created_by:id}).expect(400);
    await call('post',base).send({...module.body('Invalid active flag'),is_active:false}).expect(400);
    await call('post',base).send({...module.body('Long name'),[module.nameField]:'x'.repeat(121)}).expect(400);
    await call('post',base).send({...module.body('NUL notes'),notes:'bad\u0000text'}).expect(400);
    if (module.path !== 'designs') await call('post',base).send({...module.body('Bad phone'),phone:'abc123'}).expect(400);
    await call('patch',base+'/'+id).send({}).expect(400);
    await call('patch',base+'/'+id).send({updated_by:id}).expect(400);
    await call('get',base+'/not-a-uuid').expect(400);
    await call('get',base+'/'+id).expect(404);
    await call('patch',base+'/'+id).send({notes:'Missing record'}).expect(404);
    await call('delete',base+'/'+id).send({reason:'Missing record'}).expect(404);
    await call('get',base).query({page:'0'}).expect(400);
    await call('get',base).query({limit:'101'}).expect(400);
    await call('get',base).query({page:'1.5'}).expect(400);
    await call('get',base).query({status:'deleted'}).expect(400);
    await call('get',base).query({unknown:'field'}).expect(400);
    await call('get',base).query({sort_by:'created_at; DROP TABLE users'}).expect(400);
    await call('get',base).query('limit=1&limit=2').expect(400);
    await call('post',base+'/'+id+'/deactivate').send({}).expect(400);
  });

  test(`${module.path}: writes require trusted origin and the session CSRF token`,async () => {
    await request(f.app).post(base).set('Cookie',adminCookie).set('X-CSRF-Token',adminCsrf).send(module.body('Missing Origin')).expect(403);
    await request(f.app).post(base).set('Cookie',adminCookie).set('Origin',origin).send(module.body('Missing CSRF')).expect(403);
    await request(f.app).post(base).set('Cookie',adminCookie).set('Origin',origin).set('X-CSRF-Token','b'.repeat(64)).send(module.body('Wrong CSRF')).expect(403);
  });

  test(`${module.path}: case-insensitive search, active filters, exact filters and stable pagination`,async () => {
    const prefix = 'Filter'+module.label;
    const a = await create(module,prefix+' Alpha',module.path === 'designs' ? {design_number:'FILTER-'+module.label+'-A'} : {phone:'9991110001',city:'Pune'});
    const b = await create(module,prefix+' Beta',module.path === 'designs' ? {material:'Granite',size:'4 feet'} : {phone:'9991110002',city:'Kolhapur'});
    const c = await create(module,prefix+' Gamma',module.path === 'designs' ? {size:'4 feet'} : {phone:'9991110003',city:'Pune'});
    await call('post',base+'/'+c.id+'/deactivate').send({reason:'Inactive fixture'}).expect(200);
    const query = {q:prefix.toLowerCase(),sort_by:module.sortField,sort_order:'asc',limit:'1'};
    const page1 = await call('get',base).query(query).expect(200);
    const page2 = await call('get',base).query({...query,page:'2'}).expect(200);
    assert.deepEqual(page1.body.meta,{page:1,limit:1,total:2,total_pages:2});
    assert.equal(page1.body.data[0].id,a.id);
    assert.equal(page2.body.data[0].id,b.id);
    assert.equal((await call('get',base).query({...query,page:'3'}).expect(200)).body.data.length,0);
    assert.equal((await call('get',base).query({q:prefix,status:'all'}).expect(200)).body.meta.total,3);
    assert.equal((await call('get',base).query({q:prefix,status:'inactive'}).expect(200)).body.data[0].id,c.id);
    if (module.path === 'designs') {
      assert.equal((await call('get',base).query({q:prefix,material:'gRaNiTe',size:'4 FEET'}).expect(200)).body.data[0].id,b.id);
      assert.equal((await call('get',base).query({design_number:a.design_number}).expect(200)).body.data[0].id,a.id);
    } else {
      assert.equal((await call('get',base).query({q:prefix,city:'pUnE',status:'all'}).expect(200)).body.meta.total,2);
      assert.equal((await call('get',base).query({phone:'999 111 0002'}).expect(200)).body.data[0].id,b.id);
    }
  });

  test(`${module.path}: search treats SQL wildcard characters literally and binds injection text safely`,async () => {
    const percent = await create(module,'Literal%'+module.label);
    await create(module,'LiteralX'+module.label);
    const underscore = await create(module,'Under_score'+module.label);
    const backslash = await create(module,'Back\\slash'+module.label);
    assert.deepEqual((await call('get',base).query({q:'%'}).expect(200)).body.data.map((row: {id: string}) => row.id),[percent.id]);
    assert.deepEqual((await call('get',base).query({q:'_'}).expect(200)).body.data.map((row: {id: string}) => row.id),[underscore.id]);
    assert.deepEqual((await call('get',base).query({q:'\\'}).expect(200)).body.data.map((row: {id: string}) => row.id),[backslash.id]);
    assert.equal((await call('get',base).query({q:"'; DROP TABLE users; --"}).expect(200)).body.meta.total,0);
    assert.equal((await f.db.query<{count: string}>('SELECT count(*)::text AS count FROM divyashilla.users')).rows[0]!.count,'2');
  });

  test(`${module.path}: create/update/deactivate roll back if required activity logging fails`,async () => {
    const row = await create(module,'Rollback '+module.label);
    const count = (await f.db.query<{count: string}>(`SELECT count(*)::text AS count FROM divyashilla.${module.path}`)).rows[0]!.count;
    const failAudit: Database = {query:f.db.query,transaction:work => f.db.transaction(tx => work({
      query:async <T extends object>(sql: string,values?: unknown[]) => {
        if (sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated audit failure');
        return tx.query<T>(sql,values);
      }
    }))};
    const app = createApp(failAudit,config);
    const failed = await call('post',base,app).send(module.body('Must roll back')).expect(500);
    assert.equal(failed.text.includes('Simulated'),false);
    assert.equal((await f.db.query<{count: string}>(`SELECT count(*)::text AS count FROM divyashilla.${module.path}`)).rows[0]!.count,count);
    await call('patch',base+'/'+row.id,app).send({notes:'Must roll back'}).expect(500);
    await call('post',base+'/'+row.id+'/deactivate',app).send({reason:'Must roll back'}).expect(500);
    const current = (await call('get',base+'/'+row.id).expect(200)).body.data;
    assert.equal(current.notes,'Test notes');
    assert.equal(current.is_active,true);
    assert.equal(current.updated_at,row.updated_at);
  });
}

test('design numbers remain unique on create/update, with a safe 409 and no partial audit',async () => {
  const module = modules[1],base = '/api/v1/designs';
  const a = await create(module,'Unique Alpha',{design_number:'UNIQUE-705'});
  const b = await create(module,'Unique Beta',{design_number:'UNIQUE-706'});
  const duplicate = await call('post',base).send({...module.body('Duplicate'),design_number:' UNIQUE-705 '}).expect(409);
  assert.equal(duplicate.body.error.code,'DESIGN_NUMBER_EXISTS');
  await call('patch',base+'/'+b.id).send({design_number:a.design_number}).expect(409);
  assert.equal((await call('get',base+'/'+b.id).expect(200)).body.data.design_number,'UNIQUE-706');
  const logs = await f.db.query<{count: string}>('SELECT count(*)::text AS count FROM divyashilla.activity_logs WHERE entity_id = $1',[b.id]);
  assert.equal(logs.rows[0]!.count,'1');
});

test('design image links require an ACTIVE image owned by that design; they can be cleared',async () => {
  const module = modules[1],base = '/api/v1/designs';
  const a = await create(module,'Image Alpha'),b = await create(module,'Image Beta');
  const active = randomUUID(),pending = randomUUID(),other = randomUUID();
  for (const [id,designId,state] of [[active,a.id,'ACTIVE'],[pending,a.id,'PENDING'],[other,b.id,'ACTIVE']]) {
    await f.db.query(`INSERT INTO divyashilla.files
      (id,blob_key,original_name,mime_type,size_bytes,category,state,design_id,uploaded_by)
      VALUES ($1,$2,'test.png','image/png',100,'DESIGN_IMAGE',$3,$4,$5)`,[id,'private/'+id,state,designId,adminId]);
  }
  for (const id of [pending,other,randomUUID()]) await call('patch',base+'/'+a.id).send({image_file_id:id}).expect(400);
  const attached = (await call('patch',base+'/'+a.id).send({image_file_id:active}).expect(200)).body.data;
  assert.equal(attached.image_file_id,active);
  assert.equal(attached.blob_key,undefined);
  assert.equal((await call('patch',base+'/'+a.id).send({image_file_id:null}).expect(200)).body.data.image_file_id,null);
  await call('post',base).send({...module.body('Public URL'),image_url:'https://example.com/photo.png'}).expect(400);
});

test('phone normalization, shared customer phones, nullable text and Marathi names work',async () => {
  const customer = await create(modules[0],'मराठी ग्राहक',{phone:'+91 (98765) 43210',address:' ',notes:'Line one\nLine two'});
  assert.equal(customer.phone,'+919876543210');
  assert.equal(customer.address,null);
  assert.equal(customer.notes,'Line one\nLine two');
  await create(modules[0],'Shared family phone',{phone:'+919876543210'});
  const shared = await call('get','/api/v1/customers').query({phone:'+919876543210'}).expect(200);
  assert.equal(shared.body.meta.total,2);
  const supplier = (await call('post','/api/v1/suppliers').send({name:'कारागीर',phone:'9876543210'}).expect(201)).body.data;
  assert.equal(supplier.city,null);
  assert.equal(supplier.address,null);
  assert.equal(supplier.notes,null);
  await call('patch','/api/v1/customers/'+customer.id).send({city:null}).expect(400);
});

test('Phase 7 does not expose future management module endpoints',async () => {
  for (const path of ['users','activity-logs']) await call('get','/api/v1/'+path).expect(404);
});
