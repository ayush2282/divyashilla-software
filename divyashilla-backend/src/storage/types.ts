import type { Readable } from 'node:stream';
export interface StoredObject {stream:Readable;size:number}
// Implementations must use private objects, generated keys and exclusive writes.
// A successful put writes complete immutable bytes. Failed puts must not replace existing objects.
export interface PrivateStorage {
  initialize():Promise<void>;
  put(key:string,bytes:Buffer,mimeType:string):Promise<void>;
  open(key:string):Promise<StoredObject>;
  delete(key:string):Promise<void>;
}
export function checkedKey(key:string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) throw new Error('Invalid private storage key.');
  return key;
}
