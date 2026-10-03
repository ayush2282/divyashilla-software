import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const password = randomBytes(16).toString('hex');
const secret = randomBytes(32).toString('hex');
try {
  const template = await readFile('.env.example','utf8');
  await writeFile('.env',template.replaceAll('YOUR_LOCAL_PASSWORD',password).replace('CSRF_SECRET=','CSRF_SECRET='+secret),{flag:'wx',mode:0o600});
  console.log('Created .env with unique local secrets. Keep this file private.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') console.error('.env already exists; it was not overwritten.');
  else console.error('Could not create .env. Run this command from the project folder.');
  process.exitCode = 1;
}
