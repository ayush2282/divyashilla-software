import 'dotenv/config';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/database.js';
import { provisionUser } from '../src/modules/users/provision.js';
import { hiddenInput } from './hidden-input.js';
import { ZodError } from 'zod';

async function main() {
  const {values} = parseArgs({options:{username:{type:'string'},name:{type:'string'},role:{type:'string'}},strict:true});
  if (!values.username || !values.name || !values.role) throw new Error('Use --username ayush --name Ayush --role ADMIN (or DELIVERY).');
  const config = loadConfig();
  const password = await hiddenInput('Temporary password (12–128 characters, hidden): ');
  const confirm = await hiddenInput('Confirm temporary password: ');
  if (password !== confirm) throw new Error('Passwords did not match.');
  const db = createDatabase(config,true);
  try {
    const user = await provisionUser(db.database,{...values,password});
    console.log(`Created ${user.username} (${user.role}). Password change is required at first login.`);
  } finally { await db.close(); }
}
main().catch(error => {
  if (error instanceof ZodError) console.error('Check username, name, role and password length.');
  else if ((error as {code?: string}).code === '23505') console.error('That username already exists.');
  else if (error instanceof Error && !('code' in error)) console.error(error.message);
  else console.error('Could not create account. Check connection, migrations and owner permissions.');
  process.exitCode = 1;
});
