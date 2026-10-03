import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
import {loadConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {validateFrontend} from '../src/frontend.js';
import {azureBlobStorage} from '../src/storage/azure-blob.js';
import {fixture,config} from './helpers.js';

const production={DATABASE_URL:'postgresql://runtime:example@server/test',CSRF_SECRET:'a'.repeat(64),
  NODE_ENV:'production',PG_SSL:'true',ALLOWED_ORIGINS:'https://app.example.com',FILES_DRIVER:'azure',
  AZURE_STORAGE_ACCOUNT:'divyashillatest',AZURE_STORAGE_CONTAINER:'private-files'};
test('production configuration requires TLS, exact HTTPS origin and valid Azure storage',()=>{
  const c=loadConfig(production);assert.equal(c.secureCookie,true);assert.equal(c.cookieName,'__Host-divyashilla_session');
  for(const change of [{PG_SSL:'false'},{ALLOWED_ORIGINS:'http://app.example.com'},{ALLOWED_ORIGINS:'https://app.example.com/'},
    {FILES_DRIVER:'local'},{AZURE_STORAGE_ACCOUNT:'bad/url'},{AZURE_STORAGE_CONTAINER:'bad--name'}])assert.throws(()=>loadConfig({...production,...change}));
});
test('built frontend serves deep links while missing API/assets and private paths remain errors',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'divya-production-'));const f=await fixture();
  try{
    await writeFile(join(dir,'index.html'),'<html>DivyaShilla test shell</html>');await mkdir(join(dir,'assets'));
    await writeFile(join(dir,'assets','app.js'),'console.log("test");');await writeFile(join(dir,'.env'),'secret-test-marker');
    await validateFrontend(dir);await assert.rejects(validateFrontend(join(dir,'missing')));
    const app=createApp(f.db,{...config,FRONTEND_DIRECTORY:dir});
    const deep=await request(app).get('/deliveries/example').set('Accept','text/html').expect(200);assert.match(deep.text,/test shell/);
    const asset=await request(app).get('/assets/app.js').expect(200);assert.match(asset.headers['content-security-policy']??'',/default-src 'self'/);
    for(const url of ['/api/v1/missing','/health/missing','/assets/missing.js','/.env','/random.pdf'])await request(app).get(url).expect(404);
    await request(app).post('/customers/new').expect(404);
    await request(app).get('/health/ready').expect(200);
  }finally{await f.pg.close();await rm(dir,{recursive:true,force:true});}
});
test('Azure adapter refuses public containers and uses exclusive immutable writes',async()=>{
  let isPublic=true;let written=false;
  const storage=azureBlobStorage({getProperties:async()=>({blobPublicAccess:isPublic?'blob':undefined}),
    getBlockBlobClient:()=>({uploadData:async(bytes,options)=>{assert.equal(options.conditions.ifNoneMatch,'*');assert.equal(bytes.toString(),'bytes');written=true;},
      download:async()=>({}),deleteIfExists:async()=>{}})});
  await assert.rejects(storage.initialize(),/private/);isPublic=false;await storage.initialize();
  await storage.put('a'.repeat(8)+'-aaaa-4aaa-8aaa-'+ 'a'.repeat(12),Buffer.from('bytes'),'application/pdf');assert.equal(written,true);
  await assert.rejects(storage.put('../escape',Buffer.from('bytes'),'application/pdf'));
});

test('deployment grants restrict runtime DDL and history mutation while permitting API row locks',async()=>{
  const {readFile}=await import('node:fs/promises');const f=await fixture();
  try{
    await f.pg.exec('CREATE ROLE divyashilla_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
    const database=(await f.db.query<{name:string}>('SELECT current_database() AS name')).rows[0]!.name;
    const grants=(await readFile('../deployment/runtime-grants.sql','utf8')).replace('ON DATABASE divyashilla TO',`ON DATABASE "${database.replaceAll('"','""')}" TO`);
    await f.pg.exec(grants);await f.pg.exec('SET ROLE divyashilla_runtime');
    for(const table of ['order_financials','supplier_balances','delivery_order_details'])await f.db.query(`SELECT * FROM divyashilla.${table} LIMIT 1`);
    await f.db.query('SELECT id FROM divyashilla.files FOR SHARE');await f.db.query('SELECT id FROM divyashilla.idempotency_requests FOR UPDATE');
    for(const table of ['customer_payments','supplier_payments','order_expenses','files','activity_logs']){
      const result=(await f.db.query<{allowed:boolean}>("SELECT has_table_privilege(current_user,$1,'DELETE') AS allowed",['divyashilla.'+table])).rows[0]!;
      assert.equal(result.allowed,false);
    }
    assert.equal((await f.db.query<{allowed:boolean}>("SELECT has_schema_privilege(current_user,'divyashilla','CREATE') AS allowed")).rows[0]!.allowed,false);
    assert.equal((await f.db.query<{allowed:boolean}>("SELECT has_table_privilege(current_user,'divyashilla.activity_logs','UPDATE') AS allowed")).rows[0]!.allowed,false);
  }finally{await f.pg.exec('RESET ROLE');await f.pg.close();}
});
