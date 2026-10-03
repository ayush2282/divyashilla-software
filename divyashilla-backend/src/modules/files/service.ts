import { randomUUID } from 'node:crypto';
import type { Database,SqlExecutor } from '../../db/database.js';
import type { PrivateStorage } from '../../storage/types.js';
import type { Role } from '../auth/types.js';
import { AppError } from '../../shared/errors.js';
import { lockFinancialWrites } from '../../shared/financial-lock.js';
import { writeActivity } from '../audit/activity-log.js';
import { validateBytes,type Upload,type FileList,type Mime } from './validation.js';
export interface FileActor {id:string;role:Role;requestId:string}
interface FileRow {
  id:string;blob_key:string;original_name:string;mime_type:Mime;size_bytes:string;category:string;state:string;
  order_id:string|null;design_id:string|null;customer_payment_id:string|null;supplier_payment_id:string|null;expense_id:string|null;
  uploaded_by:string;created_at:Date;updated_at:Date;
}
const ownerColumns=['order_id','design_id','customer_payment_id','supplier_payment_id','expense_id'] as const;
const tables={order_id:'orders',design_id:'designs',customer_payment_id:'customer_payments',supplier_payment_id:'supplier_payments',expense_id:'order_expenses'} as const;
const columns=`f.id,f.blob_key,f.original_name,f.mime_type,f.size_bytes::text AS size_bytes,f.category,f.state,
  f.order_id,f.design_id,f.customer_payment_id,f.supplier_payment_id,f.expense_id,f.uploaded_by,f.created_at,f.updated_at`;
function scope(actor:FileActor,values:unknown[]) {
  if (actor.role==='ADMIN') return 'TRUE';
  values.push(actor.id);const p='$'+values.length;
  return `((f.category IN ('ORDER_PRODUCT_IMAGE','ORDER_DOCUMENT') AND EXISTS(SELECT 1 FROM divyashilla.orders o
    WHERE o.id=f.order_id AND o.assigned_delivery_user_id=${p} AND o.order_status IN ('READY_FOR_DELIVERY','DELIVERED')))
    OR (f.category='DESIGN_IMAGE' AND EXISTS(SELECT 1 FROM divyashilla.orders o WHERE o.design_image_file_id=f.id
    AND o.assigned_delivery_user_id=${p} AND o.order_status IN ('READY_FOR_DELIVERY','DELIVERED'))))`;
}
function metadata(row:FileRow,actor:FileActor) {
  const base={id:row.id,original_name:row.original_name,mime_type:row.mime_type,size_bytes:row.size_bytes,category:row.category,
    state:row.state,created_at:row.created_at,updated_at:row.updated_at,order_id:row.order_id,download_path:'/api/v1/files/'+row.id+'/download'};
  return actor.role==='ADMIN'?{...base,design_id:row.design_id,customer_payment_id:row.customer_payment_id,
    supplier_payment_id:row.supplier_payment_id,expense_id:row.expense_id,uploaded_by:row.uploaded_by}:base;
}
async function currentUser(tx:SqlExecutor,actor:FileActor) {
  const row=(await tx.query<{role:Role;is_active:boolean;must_change_password:boolean}>(
    'SELECT role,is_active,must_change_password FROM divyashilla.users WHERE id=$1 FOR SHARE',[actor.id])).rows[0];
  if (!row?.is_active || row.role!==actor.role || row.must_change_password) throw new AppError(401,'PERMISSIONS_CHANGED','Log in again after account permissions change.');
}
async function authorizeUpload(tx:SqlExecutor,input:Upload,actor:FileActor,lock=false) {
  if (actor.role==='DELIVERY' && !['ORDER_PRODUCT_IMAGE','ORDER_DOCUMENT'].includes(input.category)) throw new AppError(403,'FORBIDDEN_CATEGORY','Delivery users may upload only assigned-order photos/documents.');
  const key=ownerColumns.find(key=>key in input)!;
  const id=(input as unknown as Record<string,string>)[key]!;
  const values:unknown[]=[id];let condition='';
  if (actor.role==='DELIVERY') {values.push(actor.id);condition=" AND assigned_delivery_user_id=$2 AND order_status IN ('READY_FOR_DELIVERY','DELIVERED')";}
  const row=(await tx.query(`SELECT id FROM divyashilla.${tables[key]} WHERE id=$1 ${condition} ${lock?'FOR SHARE':''}`,values)).rows[0];
  if (!row) throw new AppError(404,'FILE_OWNER_NOT_FOUND','File owner not found.');
}
async function find(tx:SqlExecutor,id:string,actor:FileActor) {
  const values:unknown[]=[id],allowed=scope(actor,values);
  const row=(await tx.query<FileRow>(`SELECT ${columns} FROM divyashilla.files f WHERE f.id=$1 AND f.state='ACTIVE' AND (${allowed})`,values)).rows[0];
  if (!row) throw new AppError(404,'FILE_NOT_FOUND','File not found.');return row;
}
const fileAudit=(row:FileRow)=>({id:row.id,category:row.category,mime_type:row.mime_type,size_bytes:row.size_bytes,state:row.state,
  order_id:row.order_id,design_id:row.design_id,customer_payment_id:row.customer_payment_id,supplier_payment_id:row.supplier_payment_id,expense_id:row.expense_id});
export function fileService(db:Database,storage:PrivateStorage) {
  return {
    preflight:(input:Upload,actor:FileActor)=>authorizeUpload(db,input,actor),
    async upload(input:Upload,bytes:Buffer,mime:Mime,name:string,actor:FileActor) {
      validateBytes(bytes,mime,name,input);await authorizeUpload(db,input,actor);
      const key=randomUUID();let stored=false;
      try {
        await storage.put(key,bytes,mime);stored=true;
        return await db.transaction(async tx=>{
          await lockFinancialWrites(tx);await currentUser(tx,actor);await authorizeUpload(tx,input,actor,true);
          const links=ownerColumns.map(column=>(input as unknown as Record<string,string>)[column]??null);
          const id=(await tx.query<{id:string}>(`INSERT INTO divyashilla.files(blob_key,original_name,mime_type,size_bytes,category,state,
            order_id,design_id,customer_payment_id,supplier_payment_id,expense_id,uploaded_by)
            VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11) RETURNING id`,[key,name,mime,bytes.length,input.category,...links,actor.id])).rows[0]!.id;
          const row=await find(tx,id,{...actor,role:'ADMIN'});
          await writeActivity(tx,{actorId:actor.id,action:'FILE_UPLOADED',entityType:'FILE',entityId:id,after:fileAudit(row),requestId:actor.requestId});
          return metadata(row,actor);
        });
      } catch(error) {
        if (stored) await storage.delete(key).catch(()=>console.error(JSON.stringify({event:'file_cleanup_failed',requestId:actor.requestId})));
        throw error;
      }
    },
    async get(id:string,actor:FileActor) {return metadata(await find(db,id,actor),actor);},
    async download(id:string,actor:FileActor) {
      const row=await find(db,id,actor);
      let object;
      try {object=await storage.open(row.blob_key);}
      catch {throw new AppError(503,'FILE_UNAVAILABLE','Private file is unavailable. Contact ADMIN.');}
      if (BigInt(object.size)!==BigInt(row.size_bytes)) {object.stream.destroy();throw new AppError(503,'FILE_UNAVAILABLE','Private file size does not match its record.');}
      try {
        await db.transaction(async tx=>{
          await currentUser(tx,actor);const fresh=await find(tx,id,actor);
          await writeActivity(tx,{actorId:actor.id,action:'FILE_DOWNLOAD_STARTED',entityType:'FILE',entityId:id,after:fileAudit(fresh),requestId:actor.requestId});
        });
      } catch(error) {object.stream.destroy();throw error;}
      return {stream:object.stream,mime:row.mime_type,name:row.original_name,size:row.size_bytes};
    },
    async list(input:FileList,actor:FileActor) {
      if (actor.role==='DELIVERY' && (input.design_id || input.customer_payment_id || input.supplier_payment_id || input.expense_id
        || (input.category && !['ORDER_PRODUCT_IMAGE','ORDER_DOCUMENT','DESIGN_IMAGE'].includes(input.category)))) throw new AppError(403,'FORBIDDEN_FILTER','Use only delivery-safe order/category filters.');
      const values:unknown[]=[],filters=["f.state='ACTIVE'",scope(actor,values)];
      if (input.category) {values.push(input.category);filters.push('f.category=$'+values.length);}
      for (const key of ownerColumns) if (input[key]) {
        values.push(input[key]);const p='$'+values.length;
        if (key==='order_id' && actor.role==='DELIVERY') {
          values.push(actor.id);filters.push(`EXISTS(SELECT 1 FROM divyashilla.orders owned WHERE owned.id=${p} AND owned.assigned_delivery_user_id=$${values.length} AND owned.order_status IN ('READY_FOR_DELIVERY','DELIVERED'))`);
        }
        filters.push(key==='order_id'?`(f.order_id=${p} OR (f.category='DESIGN_IMAGE' AND EXISTS(SELECT 1 FROM divyashilla.orders ref WHERE ref.id=${p} AND ref.design_image_file_id=f.id)))`:'f.'+key+'='+p);
      }
      const where='WHERE '+filters.map(filter=>'('+filter+')').join(' AND ');
      return db.transaction(async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const total=Number((await tx.query<{n:string}>(`SELECT count(*)::text AS n FROM divyashilla.files f ${where}`,values)).rows[0]!.n);
        const result=await tx.query<FileRow>(`SELECT ${columns} FROM divyashilla.files f ${where} ORDER BY f.created_at ${input.sort_order},f.id ${input.sort_order}
          LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,input.limit,(input.page-1)*input.limit]);
        return {data:result.rows.map(row=>metadata(row,actor)),meta:{page:input.page,limit:input.limit,total,total_pages:Math.ceil(total/input.limit)}};
      });
    }
  };
}
