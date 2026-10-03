import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { loadConfig } from '../src/config.js';
import { writeActivity } from '../src/modules/audit/activity-log.js';
import { config, fixture, origin, testPassword } from './helpers.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { createApp } from '../src/app.js';
import request from 'supertest';

test('scrypt uses unique salts, verifies correct passwords and rejects invalid hashes',async () => {
  const a = await hashPassword(testPassword), b = await hashPassword(testPassword);
  assert.notEqual(a,b);
  assert.equal(await verifyPassword(testPassword,a),true);
  assert.equal(await verifyPassword('incorrect',a),false);
  assert.equal(await verifyPassword(testPassword,'plaintext'),false);
});

test('configuration rejects missing secrets, insecure production settings and SSL URL overrides',() => {
  assert.throws(() => loadConfig({DATABASE_URL:'postgresql://test:test@localhost/test'}),/CSRF_SECRET/);
  assert.throws(() => loadConfig({DATABASE_URL:'postgresql://test:test@localhost/test',CSRF_SECRET:'a'.repeat(64),NODE_ENV:'production'}),/Production/);
  assert.throws(() => loadConfig({DATABASE_URL:'postgresql://test:test@localhost/test?sslmode=no-verify',CSRF_SECRET:'a'.repeat(64)}),/without query options/);
});

test('local account provisioning requires an admin first and activity helper rejects secret fields',async () => {
  const f = await fixture();
  try {
    await assert.rejects(provisionUser(f.db,{name:'Tanaji',username:'tanaji',role:'DELIVERY',password:testPassword}),/ADMIN account first/);
    const ayush = await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword});
    await assert.rejects(writeActivity(f.db,{actorId:ayush.id,action:'TEST',entityType:'USER',after:{password_hash:'not allowed'}}),/Unsafe/);
    await assert.rejects(provisionUser(f.db,{name:'Duplicate',username:'AYUSH',role:'ADMIN',password:testPassword}));
    assert.equal((await f.db.query<{count: string}>('SELECT count(*)::text AS count FROM divyashilla.users')).rows[0]!.count,'1');
  } finally {await f.pg.close();}
});

test('production cookie uses Secure, HttpOnly and a host-only name',async () => {
  const f = await fixture();
  try {
    await provisionUser(f.db,{name:'Ayush',username:'ayush',role:'ADMIN',password:testPassword});
    const production = {...config,NODE_ENV:'production' as const,secureCookie:true,cookieName:'__Host-divyashilla_session'};
    const response = await request(createApp(f.db,production)).post('/api/v1/auth/login').set('Origin',origin).send({username:'ayush',password:testPassword}).expect(200);
    const header = (response.headers['set-cookie'] as string[] | undefined)?.[0];
    assert.ok(header);
    assert.match(header,/^__Host-divyashilla_session=/);
    assert.match(header,/; Secure/);
    assert.match(header,/; HttpOnly/);
    assert.equal(header.includes('Domain='),false);
  } finally {await f.pg.close();}
});
