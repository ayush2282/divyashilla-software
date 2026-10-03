import { lockFinancialWrites } from '../../shared/financial-lock.js';
import { checkSupplier } from '../../shared/ledger-records.js';
import type { Database, SqlExecutor } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { writeActivity } from '../audit/activity-log.js';
import { cents, type CreateOrder, type UpdateOrder, type StatusChange, type OrderList } from './validation.js';

type Value = string | number | boolean | null;
type Row = Record<string,Value> & {id:string;order_status:string;version:number;selling_price:string;advance_amount:string;
  buying_price:string|null;customer_id:string;design_id:string;supplier_id:string|null;order_date:string;expected_delivery_date:string|null};
type Actor = {id:string;requestId:string};
const columns = ['customer_id','design_id','supplier_id','order_date','expected_delivery_date','additional_work','buying_price',
  'selling_price','advance_amount','delivery_name','delivery_phone','delivery_city','delivery_address',
  'design_number_snapshot','design_name_snapshot','size_snapshot','material_snapshot','design_image_file_id'] as const;
// Cast bigint, dates and decimals explicitly for a stable JSON contract across pg drivers.
const projection = `o.*, o.order_number::text AS order_number,o.order_date::text AS order_date,
  o.expected_delivery_date::text AS expected_delivery_date,o.buying_price::text AS buying_price,
  o.selling_price::text AS selling_price,o.advance_amount::text AS advance_amount`;
function conflict(code:string,message:string): never {throw new AppError(409,code,message);}
async function stored(tx:SqlExecutor,id:string,lock=false):Promise<Row> {
  const result = await tx.query<Row>(`SELECT ${projection} FROM divyashilla.orders o WHERE o.id=$1 ${lock?'FOR UPDATE OF o':''}`,[id]);
  if (!result.rows[0]) throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');
  return result.rows[0];
}
async function read(tx:SqlExecutor,id:string) {
  const row = await stored(tx,id);
  const totals = await tx.query<Record<string,Value>>(`SELECT balance_amount::text,customer_net_received::text,
    delivery_expense::text,other_expense::text,profit::text,actual_delivery_date::text
    FROM divyashilla.order_financials WHERE order_id=$1`,[id]);
  return {...row,...totals.rows[0]};
}
function auditData(row:Row):Record<string,Value> {
  return Object.fromEntries(['id','order_number','order_status','version',...columns].map(key=>[key,row[key] ?? null]));
}
async function active(tx:SqlExecutor,table:'customers'|'designs'|'suppliers',id:string) {
  const result = await tx.query<Record<string,Value>>(`SELECT * FROM divyashilla.${table} WHERE id=$1 FOR SHARE`,[id]);
  if (!result.rows[0]?.is_active) throw new AppError(422,'INVALID_LINK',`Choose an existing active ${table} record.`);
  return result.rows[0];
}
async function snapshots(tx:SqlExecutor,input:CreateOrder|UpdateOrder,old?:Row) {
  const result:Record<string,Value> = {};
  if (input.customer_id !== undefined && input.customer_id !== old?.customer_id) {
    const customer = await active(tx,'customers',input.customer_id);
    Object.assign(result,{delivery_name:customer.name,delivery_phone:customer.phone,delivery_city:customer.city,delivery_address:customer.address});
  }
  if (input.design_id !== undefined && input.design_id !== old?.design_id) {
    const design = await active(tx,'designs',input.design_id);
    if (design.image_file_id) {
      const file = await tx.query(`SELECT id FROM divyashilla.files WHERE id=$1 AND design_id=$2
        AND state='ACTIVE' AND category='DESIGN_IMAGE' AND mime_type LIKE 'image/%' FOR SHARE`,[design.image_file_id,input.design_id]);
      if (!file.rows.length) conflict('INVALID_DESIGN_IMAGE','Design image is unavailable. Update the design before ordering.');
    }
    Object.assign(result,{design_number_snapshot:design.design_number,design_name_snapshot:design.design_name,
      size_snapshot:design.size,material_snapshot:design.material,design_image_file_id:design.image_file_id});
  }
  if (input.supplier_id && input.supplier_id !== old?.supplier_id) await active(tx,'suppliers',input.supplier_id);
  // Explicit delivery overrides take precedence over the copied customer details.
  for (const key of columns) if (key in input) result[key] = (input as Record<string,Value>)[key]!;
  return result;
}
function validateMerged(row:Record<string,Value>) {
  if (cents(row.advance_amount as string)>cents(row.selling_price as string)) throw new AppError(422,'ADVANCE_EXCEEDS_PRICE','Agreed advance cannot exceed selling price.');
  if (row.expected_delivery_date && (row.expected_delivery_date as string)<(row.order_date as string)) throw new AppError(422,'INVALID_DELIVERY_DATE','Expected delivery cannot precede the order date.');
  if (!['NEW','CANCELLED'].includes(row.order_status as string) && (!row.supplier_id || row.buying_price===null)) conflict('WORK_DETAILS_REQUIRED','Supplier and buying price are required before work starts.');
}
function checkVersion(row:Row,version:number) {if (row.version!==version) conflict('VERSION_CONFLICT','Order changed. Read it again before saving.');}
function editable(row:Row) {if (['DELIVERED','CANCELLED'].includes(row.order_status)) conflict('ORDER_CLOSED','Delivered and cancelled orders cannot be edited.');}
export function orderService(db:Database) {
  return {
    get:(id:string)=>read(db,id),
    async create(input:CreateOrder,actor:Actor) {
      return db.transaction(async tx=>{
        await lockFinancialWrites(tx);
        const data:Record<string,Value> = {supplier_id:null,buying_price:null,advance_amount:'0.00',expected_delivery_date:null,additional_work:null,
          ...await snapshots(tx,input),order_status:'NEW'};
        // Use the database's India-local default date when omitted; never allocate a number in JavaScript.
        if (!input.order_date) data.order_date = (await tx.query<{date:string}>(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date::text AS date`)).rows[0]!.date;
        validateMerged(data);
        const keys = columns.filter(key=>key in data);
        const result = await tx.query<{id:string}>(`INSERT INTO divyashilla.orders (${keys.join(',')},created_by,updated_by)
          VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')},$${keys.length+1},$${keys.length+1}) RETURNING id`,
          [...keys.map(key=>(data as Record<string,Value>)[key]),actor.id]);
        const row = await stored(tx,result.rows[0]!.id);
        await writeActivity(tx,{actorId:actor.id,action:'ORDER_CREATED',entityType:'ORDER',entityId:row.id,after:auditData(row),requestId:actor.requestId});
        return read(tx,row.id);
      });
    },
    async update(id:string,input:UpdateOrder,actor:Actor) {
      return db.transaction(async tx=>{
        await lockFinancialWrites(tx);
        const old = await stored(tx,id,true); checkVersion(old,input.version); editable(old);
        const relinking = ['customer_id','design_id','supplier_id'].some(key=>key in input && (input as Record<string,Value>)[key]!==old[key]);
        if (relinking) {
          if (old.order_status!=='NEW') conflict('LINKS_LOCKED','Customer, design and supplier links can change only while New.');
          const history = await tx.query<{exists:boolean}>(`SELECT EXISTS(SELECT 1 FROM divyashilla.customer_payments WHERE order_id=$1
            UNION ALL SELECT 1 FROM divyashilla.supplier_payment_allocations WHERE order_id=$1
            UNION ALL SELECT 1 FROM divyashilla.order_expenses WHERE order_id=$1) AS exists`,[id]);
          if (history.rows[0]!.exists) conflict('LINKS_HAVE_HISTORY','Orders with ledger history cannot be relinked.');
        }
        const changes = await snapshots(tx,input,old),merged = {...old,...changes}; validateMerged(merged);
        const net = await tx.query<{amount:string}>(`SELECT coalesce(sum(CASE WHEN direction='RECEIPT' THEN amount ELSE -amount END),0)::text AS amount
          FROM divyashilla.customer_payments WHERE order_id=$1 AND status='POSTED'`,[id]);
        // Compare exact decimals inside PostgreSQL, without converting them to JS numbers.
        const sufficient = await tx.query<{ok:boolean}>('SELECT $1::numeric >= $2::numeric AS ok',[merged.selling_price,net.rows[0]!.amount]);
        if (!sufficient.rows[0]!.ok) conflict('PRICE_BELOW_RECEIPTS','Selling price cannot be below recorded net receipts.');
        const keys = columns.filter(key=>key in changes && changes[key]!==old[key]);
        if (!keys.length) return read(tx,id);
        await tx.query(`UPDATE divyashilla.orders SET ${keys.map((key,i)=>key+'=$'+(i+1)).join(',')},updated_by=$${keys.length+1} WHERE id=$${keys.length+2}`,
          [...keys.map(key=>changes[key]),actor.id,id]);
        for (const supplierId of new Set([old.supplier_id,merged.supplier_id])) if (supplierId) await checkSupplier(tx,supplierId);
        const row = await stored(tx,id);
        await writeActivity(tx,{actorId:actor.id,action:'ORDER_UPDATED',entityType:'ORDER',entityId:id,before:auditData(old),after:auditData(row),requestId:actor.requestId});
        return read(tx,id);
      });
    },
    async changeStatus(id:string,input:StatusChange,actor:Actor) {
      return db.transaction(async tx=>{
        await lockFinancialWrites(tx);
        const old = await stored(tx,id,true);checkVersion(old,input.version);
        if (old.order_status===input.order_status) return read(tx,id);
        editable(old);
        const next:Record<string,string> = {NEW:'IN_WORK',IN_WORK:'READY_FOR_DELIVERY',READY_FOR_DELIVERY:'DELIVERED'};
        if (input.order_status!=='CANCELLED' && next[old.order_status]!==input.order_status) conflict('INVALID_STATUS_TRANSITION','Follow New → In Work → Ready for Delivery → Delivered.');
        validateMerged({...old,order_status:input.order_status});
        const delivery = (await tx.query<{delivery_status:string;driver_number:string|null;driver_or_bus_name:string|null}>(
          'SELECT delivery_status,driver_number,driver_or_bus_name FROM divyashilla.deliveries WHERE order_id=$1 FOR UPDATE',[id])).rows[0]!;
        if (input.order_status==='CANCELLED' && !['NOT_ASSIGNED','READY_FOR_DELIVERY'].includes(delivery.delivery_status)) conflict('ALREADY_DISPATCHED','Dispatched or issue deliveries require resolution before cancellation.');
        if (input.order_status==='DELIVERED') {
          if (delivery.delivery_status!=='SENT' || !delivery.driver_number || !delivery.driver_or_bus_name) conflict('DISPATCH_REQUIRED','A valid Sent delivery is required. Driver entry belongs to the delivery phase.');
          await tx.query(`UPDATE divyashilla.deliveries SET delivery_status='DELIVERED',delivered_at=clock_timestamp(),updated_by=$2 WHERE order_id=$1`,[id,actor.id]);
        } else if (input.order_status==='READY_FOR_DELIVERY' || input.order_status==='CANCELLED') {
          if (input.order_status==='READY_FOR_DELIVERY' && !['NOT_ASSIGNED','READY_FOR_DELIVERY'].includes(delivery.delivery_status)) conflict('DELIVERY_CONFLICT','Resolve the existing dispatch or issue before marking the order ready.');
          await tx.query('UPDATE divyashilla.deliveries SET delivery_status=$2,updated_by=$3 WHERE order_id=$1',
            [id,input.order_status==='CANCELLED'?'NOT_ASSIGNED':'READY_FOR_DELIVERY',actor.id]);
        }
        await tx.query('UPDATE divyashilla.orders SET order_status=$2,updated_by=$3 WHERE id=$1',[id,input.order_status,actor.id]);
        const row = await stored(tx,id);
        await writeActivity(tx,{actorId:actor.id,action:'ORDER_STATUS_CHANGED',entityType:'ORDER',entityId:id,
          before:{order_status:old.order_status,version:old.version,delivery_status:delivery.delivery_status},
          after:{order_status:row.order_status,version:row.version,delivery_status:input.order_status==='DELIVERED'?'DELIVERED':input.order_status==='READY_FOR_DELIVERY'?'READY_FOR_DELIVERY':input.order_status==='CANCELLED'?'NOT_ASSIGNED':delivery.delivery_status},
          reason:input.reason,requestId:actor.requestId});
        return read(tx,id);
      });
    },
    async list(input:OrderList) {
      const values:unknown[] = [],filters:string[] = [];
      const add = (expression:string,value:unknown)=>{values.push(value);filters.push(expression.replace('?', '$'+values.length));};
      for (const key of ['order_status','order_number','customer_id','design_id','supplier_id'] as const) if (input[key]) add('o.'+key+' = ?',input[key]);
      if (input.date_from) add('o.order_date >= ?',input.date_from);
      if (input.date_to) add('o.order_date <= ?',input.date_to);
      if (input.q) {values.push('%'+input.q.replace(/[\\%_]/g,'\\$&')+'%');const p='$'+values.length;
        filters.push(`(o.delivery_name ILIKE ${p} OR o.delivery_phone ILIKE ${p} OR o.delivery_city ILIKE ${p} OR o.design_name_snapshot ILIKE ${p} OR o.design_number_snapshot ILIKE ${p} OR o.order_number::text ILIKE ${p})`);}
      const where = filters.length?'WHERE '+filters.join(' AND '):'';
      // One transaction gives the count and page the same snapshot, including concurrent writes.
      return db.transaction(async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const total = Number((await tx.query<{total:string}>(`SELECT count(*)::text AS total FROM divyashilla.orders o ${where}`,values)).rows[0]!.total);
        const rows = await tx.query<Row>(`SELECT ${projection} FROM divyashilla.orders o ${where}
          ORDER BY o.${input.sort_by} ${input.sort_order} NULLS LAST,o.id ${input.sort_order} LIMIT $${values.length+1} OFFSET $${values.length+2}`,
          [...values,input.limit,(input.page-1)*input.limit]);
        return {data:rows.rows,meta:{page:input.page,limit:input.limit,total,total_pages:Math.ceil(total/input.limit)}};
      });
    }
  };
}
