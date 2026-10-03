import { constants } from 'node:fs';
import { lstat,mkdir,open,unlink } from 'node:fs/promises';
import { join,resolve,parse } from 'node:path';
import type { PrivateStorage } from './types.js';
import { checkedKey } from './types.js';
export function localStorage(directory:string):PrivateStorage {
  const root=resolve(directory);
  if (root===parse(root).root) throw new Error('Choose a dedicated private file directory.');
  async function initialize() {
    await mkdir(root,{recursive:true,mode:0o700});
    const stat=await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0) throw new Error('Private file directory must be a real directory with owner-only permissions.');
  }
  return {
    initialize,
    async put(key,bytes) {
      await initialize();const path=join(root,checkedKey(key));
      const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try {await handle.writeFile(bytes);await handle.sync();}
      catch(error) {await handle.close();await unlink(path).catch(()=>{});throw error;}
      await handle.close();
    },
    async open(key) {
      await initialize();const handle=await open(join(root,checkedKey(key)),constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const stat=await handle.stat();
        if (!stat.isFile() || (stat.mode & 0o077)!==0) throw new Error('Stored object is not a private regular file.');
        return {stream:handle.createReadStream({autoClose:true}),size:stat.size};
      } catch(error) {await handle.close();throw error;}
    },
    async delete(key) {
      await initialize();await unlink(join(root,checkedKey(key))).catch(error=>{if ((error as {code?:string}).code!=='ENOENT') throw error;});
    }
  };
}
