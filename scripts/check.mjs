import {spawnSync} from 'node:child_process';
const npm=process.platform==='win32'?'npm.cmd':'npm';
for(const folder of ['divyashilla-backend','divyashilla-frontend']) {
  for(const task of ['typecheck','test','build']) {
    const result=spawnSync(npm,['run',task],{cwd:folder,stdio:'inherit',shell:process.platform==='win32'});
    if(result.error || result.status!==0) process.exit(result.status||1);
  }
}
