import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { hashToken } from '../src/modules/auth/sessions.js';
import type { Database } from '../src/db/database.js';
import { cookie, config, fixture, origin, testPassword } from './helpers.js';

let f: Awaited<ReturnType<typeof fixture>>;
let ayushId: string;
before(async () => {
  f = await fixture();
  const ayush = await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword});
  ayushId = ayush.id;
  await provisionUser(f.db,{name:'Tanaji',username:'tanaji',role:'DELIVERY',password:testPassword});
  await f.db.query('UPDATE divyashilla.users SET must_change_password = false');
});
after(async () => { await f?.pg.close(); });

async function login(username = 'ayush',password = testPassword, app = f.app) {
  return request(app).post('/api/v1/auth/login').set('Origin',origin).send({username,password});
}

test('health APIs check migration readiness without exposing configuration',async () => {
  assert.deepEqual((await request(f.app).get('/health/live').expect(200)).body,{status:'ok'});
  assert.deepEqual((await request(f.app).get('/health/ready').expect(200)).body,{status:'ready'});
  const down: Database = {query:async () => {throw new Error('secret connection details');},transaction:f.db.transaction};
  const app = createApp(down,config);
  assert.equal((await request(app).get('/health/ready').expect(503)).text.includes('secret'),false);
  await request(app).get('/health/live').expect(200);
});

test('login sets an HttpOnly session cookie, stores only its hash, returns safe user data',async () => {
  const result = await login('AYUSH');
  assert.equal(result.status,200);
  assert.equal(result.body.user.role,'ADMIN');
  assert.equal(result.body.user.password_hash,undefined);
  assert.equal(result.body.session,undefined);
  const setCookie = (result.headers['set-cookie'] as string[] | undefined)?.[0];
  assert.ok(setCookie);
  assert.match(setCookie,/HttpOnly/);
  assert.match(setCookie,/SameSite=Lax/);
  assert.match(setCookie,/Path=\//);
  const token = cookie(result).split('=')[1]!;
  const stored = await f.db.query<{token_hash: string}>('SELECT token_hash FROM divyashilla.sessions WHERE token_hash = $1',[hashToken(token)]);
  assert.equal(stored.rows.length,1);
  assert.notEqual(stored.rows[0]!.token_hash,token);
  const me = await request(f.app).get('/api/v1/auth/me').set('Cookie',cookie(result)).expect(200);
  assert.equal(me.body.csrfToken,result.body.csrfToken);
  assert.equal(me.headers['cache-control'],'no-store');
});

test('unknown username and wrong password produce the same generic rejection',async () => {
  const wrong = await login('ayush','wrong-password');
  const unknown = await login('unknown-user','wrong-password');
  assert.equal(wrong.status,401);
  assert.equal(unknown.status,401);
  assert.deepEqual(wrong.body.error,unknown.body.error);
});

test('no session is unauthorized; Tanaji cannot access ADMIN endpoints',async () => {
  await request(f.app).get('/api/v1/access/admin').expect(401);
  const tanaji = await login('tanaji');
  const headers = {Cookie:cookie(tanaji)};
  await request(f.app).get('/api/v1/access/admin').set(headers).expect(403);
  await request(f.app).get('/api/v1/access/delivery').set(headers).expect(200);
  const ayush = await login();
  await request(f.app).get('/api/v1/access/admin').set('Cookie',cookie(ayush)).expect(200);
});

test('current role and active flag take effect on an existing session',async () => {
  const result = await login();
  await f.db.query("UPDATE divyashilla.users SET role = 'DELIVERY' WHERE id = $1",[ayushId]);
  await request(f.app).get('/api/v1/access/admin').set('Cookie',cookie(result)).expect(403);
  await f.db.query("UPDATE divyashilla.users SET role = 'ADMIN',is_active = false WHERE id = $1",[ayushId]);
  await request(f.app).get('/api/v1/auth/me').set('Cookie',cookie(result)).expect(401);
  assert.equal((await login()).status,401);
  await f.db.query('UPDATE divyashilla.users SET is_active = true WHERE id = $1',[ayushId]);
});

test('origin and CSRF checks protect login/logout mutations',async () => {
  await request(f.app).post('/api/v1/auth/login').send({username:'ayush',password:testPassword}).expect(403);
  await request(f.app).post('/api/v1/auth/login').set('Origin','https://untrusted.example').send({username:'ayush',password:testPassword}).expect(403);
  const result = await login();
  await request(f.app).post('/api/v1/auth/logout').set('Origin',origin).set('Cookie',cookie(result)).expect(403);
  await request(f.app).post('/api/v1/auth/logout').set('Origin',origin).set('Cookie',cookie(result)).set('X-CSRF-Token','b'.repeat(64)).expect(403);
  await request(f.app).post('/api/v1/auth/logout').set('Origin',origin).set('Cookie',cookie(result)).set('X-CSRF-Token',result.body.csrfToken).expect(204);
  await request(f.app).get('/api/v1/auth/me').set('Cookie',cookie(result)).expect(401);
});

test('expired sessions are rejected',async () => {
  const result = await login();
  await f.db.query("UPDATE divyashilla.sessions SET expires_at = created_at + interval '1 microsecond' WHERE token_hash = $1",[hashToken(cookie(result).split('=')[1]!)]);
  await request(f.app).get('/api/v1/auth/me').set('Cookie',cookie(result)).expect(401);
});

test('first-login password change rotates the cookie and revokes all old sessions',async () => {
  await provisionUser(f.db,{name:'New User',username:'newuser',role:'DELIVERY',password:testPassword});
  const first = await login('newuser');
  const second = await login('newuser');
  assert.equal(first.body.user.mustChangePassword,true);
  const blocked = await request(f.app).get('/api/v1/access/delivery').set('Cookie',cookie(first)).expect(403);
  assert.equal(blocked.body.error.code,'PASSWORD_CHANGE_REQUIRED');
  await request(f.app).post('/api/v1/auth/change-password').set('Origin',origin).set('Cookie',cookie(first))
    .set('X-CSRF-Token',first.body.csrfToken).send({currentPassword:'incorrect',newPassword:'Changed-password-456!'}).expect(401);
  const changed = await request(f.app).post('/api/v1/auth/change-password').set('Origin',origin).set('Cookie',cookie(first))
    .set('X-CSRF-Token',first.body.csrfToken).send({currentPassword:testPassword,newPassword:'Changed-password-456!'}).expect(200);
  assert.equal(changed.body.user.mustChangePassword,false);
  assert.notEqual(cookie(first),cookie(changed));
  await request(f.app).get('/api/v1/auth/me').set('Cookie',cookie(first)).expect(401);
  await request(f.app).get('/api/v1/auth/me').set('Cookie',cookie(second)).expect(401);
  await request(f.app).get('/api/v1/access/delivery').set('Cookie',cookie(changed)).expect(200);
  assert.equal((await login('newuser',testPassword)).status,401);
  assert.equal((await login('newuser','Changed-password-456!')).status,200);
});

test('bad input and malformed JSON are rejected without secret details',async () => {
  await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username:'ayush',password:testPassword,role:'ADMIN'}).expect(400);
  await request(f.app).post('/api/v1/auth/login').set('Origin',origin).send({username:"' OR 1=1",password:testPassword}).expect(400);
  const bad = await request(f.app).post('/api/v1/auth/login').set('Origin',origin).set('Content-Type','application/json').send('{"broken"').expect(400);
  assert.equal(bad.body.error.code,'INVALID_JSON');
  await request(f.app).get('/does-not-exist').expect(404);
});

test('login rate limit is enforced without hitting the password hasher',async () => {
  const app = createApp(f.db,config);
  for (let i=0;i<20;i++) await request(app).post('/api/v1/auth/login').set('Origin',origin).send({}).expect(400);
  await request(app).post('/api/v1/auth/login').set('Origin',origin).send({}).expect(429);
});

test('login rolls back session and last_login_at if its required audit insert fails',async () => {
  const user = await provisionUser(f.db,{name:'Rollback',username:'rollback',role:'DELIVERY',password:testPassword});
  const failAudit: Database = {
    query:f.db.query,
    transaction:work => f.db.transaction(tx => work({query:async <T extends object>(sql: string,values?: unknown[]) => {
      if (sql.includes('INSERT INTO divyashilla.activity_logs')) throw new Error('Simulated audit failure');
      return tx.query<T>(sql,values);
    }}))
  };
  const response = await login('rollback',testPassword,createApp(failAudit,config));
  assert.equal(response.status,500);
  assert.equal(response.text.includes('Simulated'),false);
  const result = await f.db.query<{count: string}>('SELECT count(*)::text AS count FROM divyashilla.sessions WHERE user_id = $1',[user.id]);
  assert.equal(result.rows[0]!.count,'0');
  const stored = await f.db.query<{last_login_at: Date | null}>('SELECT last_login_at FROM divyashilla.users WHERE id = $1',[user.id]);
  assert.equal(stored.rows[0]!.last_login_at,null);
});

test('auth activity logs do not contain passwords or session tokens',async () => {
  const logs = await f.db.query('SELECT action,before_data,after_data,reason FROM divyashilla.activity_logs');
  const text = JSON.stringify(logs.rows);
  assert.equal(text.includes(testPassword),false);
  assert.equal(text.includes('scrypt$'),false);
  assert.equal(text.includes('token_hash'),false);
  assert.equal(logs.rows.some(row => row.action === 'AUTH_PASSWORD_CHANGED'),true);
});
