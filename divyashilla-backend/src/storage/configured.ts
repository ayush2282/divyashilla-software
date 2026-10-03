import { BlobServiceClient } from '@azure/storage-blob';
import { ManagedIdentityCredential } from '@azure/identity';
import type { Config } from '../config.js';
import { azureBlobStorage } from './azure-blob.js';
import { localStorage } from './local.js';
import type { PrivateStorage } from './types.js';

// Production uses only the App Service system-assigned identity, never a key/SAS.
export function configuredStorage(config:Config):PrivateStorage {
  if(config.FILES_DRIVER==='local') {
    if(config.NODE_ENV==='production') throw new Error('Production requires Azure private storage.');
    return localStorage(config.FILES_DIRECTORY);
  }
  const client=new BlobServiceClient(`https://${config.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
    new ManagedIdentityCredential(),{retryOptions:{maxTries:3,tryTimeoutInMs:15000}});
  return azureBlobStorage(client.getContainerClient(config.AZURE_STORAGE_CONTAINER));
}
