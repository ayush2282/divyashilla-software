import 'dotenv/config';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { hiddenInput } from './hidden-input.js';

async function main() {
  const {values} = parseArgs({options:{username:{type:'string'}},strict:true});
  if (!values.username) throw new Error('Use --username ayush (or tanaji).');
  const config = loadConfig();
  if (config.NODE_ENV === 'production') throw new Error('This check is for local development only.');
  const base = `http://${config.HOST}:${config.PORT}`;
  let sessionCookie = '', csrf = '';
  const call = async (path: string,body?: object) => {
    const response = await fetch(base+path,{
      method:body ? 'POST' : 'GET',
      headers:{Origin:config.allowedOrigins[0]!,...(body ? {'Content-Type':'application/json'} : {}),
        ...(sessionCookie ? {Cookie:sessionCookie,'X-CSRF-Token':csrf} : {})},
      body:body ? JSON.stringify(body) : undefined
    });
    const header = response.headers.get('set-cookie');
    if (header) sessionCookie = header.split(';')[0]!;
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? 'API check failed.');
    if (data.csrfToken) csrf = data.csrfToken;
    return data;
  };
  const password = await hiddenInput('Password (hidden): ');
  let data = await call('/api/v1/auth/login',{username:values.username,password});
  if (data.user.mustChangePassword) {
    const next = await hiddenInput('New permanent password (12–128 characters, hidden): ');
    const confirm = await hiddenInput('Confirm new password: ');
    if (next !== confirm) throw new Error('New passwords did not match.');
    data = await call('/api/v1/auth/change-password',{currentPassword:password,newPassword:next});
    console.log('Password changed; old sessions revoked.');
  }
  await call('/api/v1/auth/me');
  await call(data.user.role === 'ADMIN' ? '/api/v1/access/admin' : '/api/v1/access/delivery');
  console.log(`Login and permissions OK for ${data.user.username} (${data.user.role}).`);
  await call('/api/v1/auth/logout',{});
  console.log('Logout OK.');
}
main().catch(error => {
  console.error(error instanceof Error && !(error instanceof TypeError) ? error.message : 'Could not reach backend. Start npm run dev first.');
  process.exitCode = 1;
});
