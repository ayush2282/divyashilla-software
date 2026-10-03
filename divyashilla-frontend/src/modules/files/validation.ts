import { z } from 'zod';
import { ownerCategories,type FileCategory,type FileOwner,type OwnerKey } from './types';
export const MAX_FILE_BYTES=10485760; // Same cap as files.size_bytes CHECK and backend raw-body limit.
export const mimeTypes=['image/jpeg','image/png','image/webp','application/pdf'] as const;
const extensions:Record<string,RegExp>={'image/jpeg':/\.jpe?g$/i,'image/png':/\.png$/i,'image/webp':/\.webp$/i,'application/pdf':/\.pdf$/i};
export const filenameSchema=z.string().trim().min(1).max(200).refine(v=>!/[\u0000-\u001f\u007f/\\]/.test(v)&&!['.','..'].includes(v),'Use a filename without paths or control characters.');
export function selectedMime(file:Pick<File,'name'|'type'>) {return file.type||Object.entries(extensions).find(([,pattern])=>pattern.test(file.name.trim()))?.[0]||'';}
export function validateFile(file:Pick<File,'name'|'type'|'size'>|null,category:FileCategory):string|null {
  if(!file)return 'Choose a file.';
  if(!filenameSchema.safeParse(file.name).success)return 'Use a filename up to 200 characters without paths or control characters.';
  if(file.size<1)return 'The file is empty.';if(file.size>MAX_FILE_BYTES)return 'Maximum file size is 10 MiB (10,485,760 bytes).';
  const mime=selectedMime(file);if(!mimeTypes.includes(mime as typeof mimeTypes[number]))return 'Use JPEG, PNG, WebP or PDF only.';
  if(!extensions[mime]?.test(file.name.trim()))return 'Filename extension must match the file type.';
  if(['DESIGN_IMAGE','ORDER_PRODUCT_IMAGE'].includes(category)&&mime==='application/pdf')return 'This category requires a JPEG, PNG or WebP image.';
  return null;
}
export function validFileOwner(owner:FileOwner,category:FileCategory,admin:boolean) {
  const keys=Object.keys(owner);if(keys.length!==1)return false;const key=keys[0] as OwnerKey,value=Object.values(owner)[0];
  return z.string().uuid().safeParse(value).success&&Boolean(ownerCategories[key]?.includes(category))&&(admin||key==='order_id');
}
