import { z } from 'zod';
import { listFields } from '../../shared/master-validation.js';
import { AppError } from '../../shared/errors.js';
export const MAX_FILE_BYTES=10485760; // Must match the existing files.size_bytes CHECK.
export const mimeSchema=z.enum(['image/jpeg','image/png','image/webp','application/pdf']);
export type Mime=z.infer<typeof mimeSchema>;
export const categorySchema=z.enum(['DESIGN_IMAGE','ORDER_PRODUCT_IMAGE','ORDER_DOCUMENT','CUSTOMER_PAYMENT_DOCUMENT','SUPPLIER_PAYMENT_DOCUMENT','EXPENSE_DOCUMENT']);
export const uploadSchema=z.discriminatedUnion('category',[
  z.object({category:z.literal('DESIGN_IMAGE'),design_id:z.string().uuid()}).strict(),
  z.object({category:z.literal('ORDER_PRODUCT_IMAGE'),order_id:z.string().uuid()}).strict(),
  z.object({category:z.literal('ORDER_DOCUMENT'),order_id:z.string().uuid()}).strict(),
  z.object({category:z.literal('CUSTOMER_PAYMENT_DOCUMENT'),customer_payment_id:z.string().uuid()}).strict(),
  z.object({category:z.literal('SUPPLIER_PAYMENT_DOCUMENT'),supplier_payment_id:z.string().uuid()}).strict(),
  z.object({category:z.literal('EXPENSE_DOCUMENT'),expense_id:z.string().uuid()}).strict()
]);
export type Upload=z.infer<typeof uploadSchema>;
export const filenameSchema=z.string().trim().min(1).max(200)
  .refine(value=>!/[\u0000-\u001f\u007f/\\]/.test(value) && !['.','..'].includes(value),'Use a filename without paths or control characters.');
const listSchema=z.object({page:listFields.page,limit:listFields.limit,sort_order:listFields.sort_order,
  category:categorySchema.optional(),order_id:z.string().uuid().optional(),design_id:z.string().uuid().optional(),
  customer_payment_id:z.string().uuid().optional(),supplier_payment_id:z.string().uuid().optional(),expense_id:z.string().uuid().optional()
}).strict();
export const fileListSchema=listSchema.refine(value=>['order_id','design_id','customer_payment_id','supplier_payment_id','expense_id']
  .filter(key=>value[key as keyof typeof value]!==undefined).length<=1,'Choose at most one owner filter.');
export type FileList=z.infer<typeof fileListSchema>;
export function decodedFilename(header:string|undefined) {
  let value:string|undefined;
  try {value=header===undefined?undefined:decodeURIComponent(header);}
  catch {throw new AppError(400,'INVALID_FILENAME','Use a URI-encoded X-File-Name header.');}
  return filenameSchema.parse(value);
}
export function uploadMime(header:string|undefined):Mime {
  const result=mimeSchema.safeParse(header?.split(';')[0]?.trim().toLowerCase());
  if (!result.success) throw new AppError(415,'UNSUPPORTED_FILE_TYPE','Use JPEG, PNG, WebP or PDF bytes with the matching Content-Type.');
  return result.data;
}
export function validateBytes(bytes:Buffer,mime:Mime,name:string,input:Upload) {
  if (!Buffer.isBuffer(bytes) || bytes.length===0) throw new AppError(400,'EMPTY_FILE','Upload a nonempty file.');
  if (bytes.length>MAX_FILE_BYTES) throw new AppError(413,'BODY_TOO_LARGE','File exceeds 10 MiB.');
  let detected:Mime|undefined;
  if (bytes.length>=12 && bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])) && bytes.subarray(-2).equals(Buffer.from([0xff,0xd9]))) detected='image/jpeg';
  if (bytes.length>=45 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16)==='IHDR'
    && bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]))) detected='image/png';
  if (bytes.length>=20 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP'
    && ['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16)) && bytes.readUInt32LE(4)+8===bytes.length) detected='image/webp';
  const tail=bytes.subarray(-1024).toString('latin1');
  if (/^%PDF-[12]\.[0-9]/.test(bytes.subarray(0,8).toString('ascii')) && /%%EOF[\t\r\n ]*$/.test(tail)) detected='application/pdf';
  if (detected!==mime) throw new AppError(415,'FILE_TYPE_MISMATCH','File signatures do not match the declared type.');
  const extensions:Record<Mime,RegExp>={'image/jpeg':/\.jpe?g$/i,'image/png':/\.png$/i,'image/webp':/\.webp$/i,'application/pdf':/\.pdf$/i};
  if (!extensions[mime].test(name)) throw new AppError(400,'INVALID_EXTENSION','Filename extension must match the file type.');
  if (['DESIGN_IMAGE','ORDER_PRODUCT_IMAGE'].includes(input.category) && mime==='application/pdf') throw new AppError(400,'IMAGE_REQUIRED','This category requires an image.');
}
