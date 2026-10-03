import { Readable } from 'node:stream';
import type { PrivateStorage } from './types.js';
import { checkedKey } from './types.js';
// Structural port keeps this adapter independently testable.
// configured.ts injects the official SDK ContainerClient with managed identity.
export interface AzureContainerPort {
  getProperties():Promise<{blobPublicAccess?:string}>;
  getBlockBlobClient(key:string):{
    uploadData(bytes:Buffer,options:{conditions:{ifNoneMatch:string};blobHTTPHeaders:{blobContentType:string}}):Promise<unknown>;
    download():Promise<{readableStreamBody?:NodeJS.ReadableStream;contentLength?:number}>;
    deleteIfExists():Promise<unknown>;
  };
}
export function azureBlobStorage(container:AzureContainerPort):PrivateStorage {
  async function initialize() {
    const properties=await container.getProperties();
    if (properties.blobPublicAccess) throw new Error('Azure file container must be private.');
  }
  return {
    initialize,
    async put(key,bytes,mimeType) {
      await initialize();await container.getBlockBlobClient(checkedKey(key)).uploadData(bytes,
        {conditions:{ifNoneMatch:'*'},blobHTTPHeaders:{blobContentType:mimeType}});
    },
    async open(key) {
      await initialize();const response=await container.getBlockBlobClient(checkedKey(key)).download();
      const size=response.contentLength;
      if (!response.readableStreamBody || size===undefined || !Number.isSafeInteger(size) || size<1) throw new Error('Private blob unavailable.');
      return {stream:Readable.from(response.readableStreamBody as AsyncIterable<Uint8Array>),size};
    },
    async delete(key) {await initialize();await container.getBlockBlobClient(checkedKey(key)).deleteIfExists();}
  };
}
