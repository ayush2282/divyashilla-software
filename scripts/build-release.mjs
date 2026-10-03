import {spawnSync} from 'node:child_process';
import {cp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
if(Number(process.versions.node.split('.')[0])!==24) throw new Error('Use Node.js 24.');
const npm=process.platform==='win32'?'npm.cmd':'npm';
function run(args,cwd){const r=spawnSync(npm,args,{cwd,stdio:'inherit',shell:process.platform==='win32'});if(r.error||r.status!==0)throw new Error('Release command failed.');}
run(['run','build'],'divyashilla-frontend');run(['run','build'],'divyashilla-backend');
const target=resolve('release/app');await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
for(const name of ['dist','package.json','package-lock.json'])await cp(resolve('divyashilla-backend',name),resolve(target,name),{recursive:true});
await cp(resolve('divyashilla-frontend/dist'),resolve(target,'public'),{recursive:true});
run(['ci','--omit=dev','--ignore-scripts'],target);
await writeFile(resolve(target,'RELEASE.json'),JSON.stringify({version:JSON.parse(await readFile('package.json','utf8')).version,node:process.versions.node,built_at:new Date().toISOString()},null,2));
console.log('Ready: release/app. ZIP its CONTENTS on Linux for App Service; no deploy was run.');
