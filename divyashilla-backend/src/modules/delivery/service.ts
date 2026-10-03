import type { Database,SqlExecutor } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { lockFinancialWrites } from '../../shared/financial-lock.js';
import { writeActivity } from '../audit/activity-log.js';
import type { Role } from '../auth/types.js';
import type { AssigneeList,AssignDelivery,CompleteDelivery,DeliveryList,DriverUpdate,IssueDelivery,SendDelivery } from './validation.js';

type Status='NOT_ASSIGNED'|'READY_FOR_DELIVERY'|'SENT'|'DELIVERED'|'ISSUE';
export interface DeliveryActor {id:string;role:Role;requestId:string}
interface LockedDelivery {
  delivery_id:string;order_id:string;order_status:string;assigned_delivery_user_id:string|null;version:number;
  delivery_status:Status;driver_number:string|null;driver_or_bus_name:string|null;bus_number:string|null;delivered_at:Date|null;
}
interface SafeDelivery extends LockedDelivery {
  order_number:string;order_date:string;customer_name:string;customer_phone:string;customer_city:string;customer_address:string|null;
  design_number:string;design_name:string;size:string;material:string;additional_work:string|null;expected_delivery_date:string|null;
  updated_by:string;delivery_updated_at:Date;issue_reason:string|null;
}
// Both ADMIN and DELIVERY receive this exact whitelist. Never serialize an order row.
const responseKeys=['delivery_id','order_id','order_number','order_date','order_status','assigned_delivery_user_id','version',
  'customer_name','customer_phone','customer_city','customer_address','design_number','design_name','size','material','additional_work',
  'expected_delivery_date','delivery_status','driver_number','driver_or_bus_name','bus_number','delivered_at','updated_by','delivery_updated_at','issue_reason'] as const;
const safeResponse=(row:SafeDelivery)=>Object.fromEntries(responseKeys.map(key=>[key,row[key]]));
const projection=`d.id AS delivery_id,v.order_id,v.order_number::text AS order_number,v.order_date::text AS order_date,
  v.order_status,v.assigned_delivery_user_id,v.version,v.customer_name,v.customer_phone,v.customer_city,v.customer_address,
  v.design_number,v.design_name,v.size,v.material,v.additional_work,v.expected_delivery_date::text AS expected_delivery_date,
  v.delivery_status,v.driver_number,v.driver_or_bus_name,v.bus_number,v.delivered_at,v.updated_by,v.delivery_updated_at,
  CASE WHEN v.delivery_status='ISSUE' THEN (SELECT reason FROM divyashilla.activity_logs a
    WHERE a.entity_type='DELIVERY' AND a.entity_id=d.id AND a.action='DELIVERY_ISSUE_REPORTED'
    ORDER BY (a.after_data->>'version')::integer DESC NULLS LAST,a.created_at DESC,a.id DESC LIMIT 1) ELSE NULL END AS issue_reason`;
function conflict(code:string,message:string):never {throw new AppError(409,code,message);}
function scope(actor:DeliveryActor,alias:string,values:unknown[]) {
  if (actor.role==='ADMIN') return 'TRUE';
  values.push(actor.id);
  return `${alias}.assigned_delivery_user_id=$${values.length} AND ${alias}.order_status IN ('READY_FOR_DELIVERY','DELIVERED')`;
}
async function read(tx:SqlExecutor,id:string,actor:DeliveryActor) {
  const values:unknown[]=[id],allowed=scope(actor,'v',values);
  const row=(await tx.query<SafeDelivery>(`SELECT ${projection} FROM divyashilla.delivery_order_details v
    JOIN divyashilla.deliveries d ON d.order_id=v.order_id WHERE d.id=$1 AND (${allowed})`,values)).rows[0];
  if (!row) throw new AppError(404,'DELIVERY_NOT_FOUND','Delivery not found.');
  return safeResponse(row);
}
async function locked(tx:SqlExecutor,id:string,actor:DeliveryActor) {
  const values:unknown[]=[id],allowed=scope(actor,'o',values);
  const row=(await tx.query<LockedDelivery>(`SELECT d.id AS delivery_id,o.id AS order_id,o.order_status,o.assigned_delivery_user_id,o.version,
    d.delivery_status,d.driver_number,d.driver_or_bus_name,d.bus_number,d.delivered_at
    FROM divyashilla.orders o JOIN divyashilla.deliveries d ON d.order_id=o.id
    WHERE d.id=$1 AND (${allowed}) FOR UPDATE OF o,d`,values)).rows[0];
  if (!row) throw new AppError(404,'DELIVERY_NOT_FOUND','Delivery not found.');return row;
}
function snapshot(row:LockedDelivery) {
  return {order_id:row.order_id,order_status:row.order_status,assigned_delivery_user_id:row.assigned_delivery_user_id,version:row.version,
    delivery_status:row.delivery_status,driver_number:row.driver_number,driver_or_bus_name:row.driver_or_bus_name,bus_number:row.bus_number,
    delivered_at:row.delivered_at?new Date(row.delivered_at).toISOString():null};
}
function readyOrder(row:LockedDelivery) {
  if (row.order_status!=='READY_FOR_DELIVERY') conflict('ORDER_NOT_READY','Only an order ready for delivery can be updated.');
}
async function eligibleUser(tx:SqlExecutor,id:string) {
  const result=await tx.query(`SELECT id FROM divyashilla.users WHERE id=$1 AND role='DELIVERY' AND is_active FOR SHARE`,[id]);
  if (!result.rows.length) conflict('INVALID_ASSIGNEE','Choose an active DELIVERY user.');
}
export function deliveryService(db:Database) {
  async function mutate(id:string,version:number,actor:DeliveryActor,work:(tx:SqlExecutor,row:LockedDelivery)=>Promise<void>) {
    return db.transaction(async tx=>{
      await lockFinancialWrites(tx);
      const row=await locked(tx,id,actor);
      if (row.version!==version) conflict('VERSION_CONFLICT','Delivery or order changed. Read it again before saving.');
      await work(tx,row);return read(tx,id,actor);
    });
  }
  async function finish(tx:SqlExecutor,old:LockedDelivery,actor:DeliveryActor,action:string,reason?:string,
    orderStatus=old.order_status,assignedUser=old.assigned_delivery_user_id) {
    if (assignedUser) await eligibleUser(tx,assignedUser);
    // A shared order version also advances for driver-only edits and issue notes.
    await tx.query('UPDATE divyashilla.orders SET order_status=$2,assigned_delivery_user_id=$3,updated_by=$4 WHERE id=$1',
      [old.order_id,orderStatus,assignedUser,actor.id]);
    const after=await locked(tx,old.delivery_id,{...actor,role:'ADMIN'});
    await writeActivity(tx,{actorId:actor.id,action,entityType:'DELIVERY',entityId:old.delivery_id,
      before:snapshot(old),after:snapshot(after),...(reason?{reason}:{}),requestId:actor.requestId});
    if (old.order_status!==after.order_status) await writeActivity(tx,{actorId:actor.id,action:'ORDER_STATUS_CHANGED',entityType:'ORDER',entityId:old.order_id,
      before:{order_status:old.order_status,version:old.version},after:{order_status:after.order_status,version:after.version},
      reason:'Delivery confirmed complete',requestId:actor.requestId});
  }
  return {
    async assignees(input:AssigneeList,actor:DeliveryActor) {
      if (actor.role!=='ADMIN') throw new AppError(403,'FORBIDDEN','Only ADMIN can list delivery assignees.');
      const values:unknown[]=[],filters=["role='DELIVERY'",'is_active'];
      if (input.id) {values.push(input.id);filters.push('id=$'+values.length);}
      if (input.q) {values.push('%'+input.q.replace(/[\\%_]/g,'\\$&')+'%');const p='$'+values.length;filters.push('(name ILIKE '+p+' OR username ILIKE '+p+')');}
      const where=filters.join(' AND ');
      return db.transaction(async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const total=Number((await tx.query<{n:string}>('SELECT count(*)::text AS n FROM divyashilla.users WHERE '+where,values)).rows[0]!.n);
        const rows=await tx.query<{id:string;name:string;username:string}>('SELECT id,name,username FROM divyashilla.users WHERE '+where+
          ' ORDER BY name,id LIMIT $'+(values.length+1)+' OFFSET $'+(values.length+2),[...values,input.limit,(input.page-1)*input.limit]);
        return {data:rows.rows,meta:{page:input.page,limit:input.limit,total,total_pages:Math.ceil(total/input.limit)}};
      });
    },
    get:(id:string,actor:DeliveryActor)=>read(db,id,actor),
    async list(input:DeliveryList,actor:DeliveryActor) {
      if (actor.role==='DELIVERY' && input.assigned_delivery_user_id) throw new AppError(403,'FORBIDDEN_FILTER','Delivery users cannot choose another assignment filter.');
      const values:unknown[]=[],filters=[scope(actor,'v',values)];
      const add=(sql:string,value:unknown)=>{values.push(value);filters.push(sql.replace('?', '$'+values.length));};
      if (input.assigned_delivery_user_id) add('v.assigned_delivery_user_id=?',input.assigned_delivery_user_id);
      if (input.delivery_status) add('v.delivery_status=?',input.delivery_status);
      if (input.expected_from) add('v.expected_delivery_date>=?',input.expected_from);
      if (input.expected_to) add('v.expected_delivery_date<=?',input.expected_to);
      if (input.q) {values.push('%'+input.q.replace(/[\\%_]/g,'\\$&')+'%');const p='$'+values.length;
        filters.push(`(v.customer_name ILIKE ${p} OR v.customer_phone ILIKE ${p} OR v.customer_city ILIKE ${p}
          OR v.design_name ILIKE ${p} OR v.design_number ILIKE ${p} OR v.order_number::text ILIKE ${p})`);}
      const where='WHERE '+filters.map(filter=>'('+filter+')').join(' AND ');
      return db.transaction(async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const total=Number((await tx.query<{n:string}>(`SELECT count(*)::text AS n FROM divyashilla.delivery_order_details v ${where}`,values)).rows[0]!.n);
        const rows=await tx.query<SafeDelivery>(`SELECT ${projection} FROM divyashilla.delivery_order_details v
          JOIN divyashilla.deliveries d ON d.order_id=v.order_id ${where}
          ORDER BY v.${input.sort_by} ${input.sort_order} NULLS LAST,d.id ${input.sort_order}
          LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,input.limit,(input.page-1)*input.limit]);
        return {data:rows.rows.map(safeResponse),meta:{page:input.page,limit:input.limit,total,total_pages:Math.ceil(total/input.limit)}};
      });
    },
    assign:(id:string,input:AssignDelivery,actor:DeliveryActor)=>{
      if (actor.role!=='ADMIN') throw new AppError(403,'FORBIDDEN','Only ADMIN can assign deliveries.');
      return mutate(id,input.version,actor,async(tx,row)=>{
        readyOrder(row);
        if (!['READY_FOR_DELIVERY','SENT','ISSUE'].includes(row.delivery_status)) conflict('ASSIGNMENT_CLOSED','This delivery cannot be reassigned.');
        if (input.assigned_delivery_user_id===row.assigned_delivery_user_id) return;
        if (input.assigned_delivery_user_id===null && row.delivery_status!=='READY_FOR_DELIVERY') conflict('IN_TRANSIT','In-transit or issue deliveries must retain an assignee.');
        if (input.assigned_delivery_user_id) await eligibleUser(tx,input.assigned_delivery_user_id);
        await tx.query('UPDATE divyashilla.deliveries SET updated_by=$2 WHERE id=$1',[id,actor.id]);
        await finish(tx,row,actor,'DELIVERY_ASSIGNED',input.reason,row.order_status,input.assigned_delivery_user_id);
      });
    },
    send:(id:string,input:SendDelivery,actor:DeliveryActor)=>mutate(id,input.version,actor,async(tx,row)=>{
      readyOrder(row);
      if (row.delivery_status!=='READY_FOR_DELIVERY') conflict('INVALID_DELIVERY_TRANSITION','Only Ready for Delivery can become Sent.');
      await tx.query(`UPDATE divyashilla.deliveries SET delivery_status='SENT',driver_number=$2,driver_or_bus_name=$3,bus_number=$4,updated_by=$5 WHERE id=$1`,
        [id,input.driver_number,input.driver_or_bus_name,input.bus_number??null,actor.id]);
      await finish(tx,row,actor,'DELIVERY_SENT');
    }),
    updateDriver:(id:string,input:DriverUpdate,actor:DeliveryActor)=>mutate(id,input.version,actor,async(tx,row)=>{
      readyOrder(row);
      if (row.delivery_status!=='SENT') conflict('DELIVERY_NOT_SENT','Driver details can be edited only while Sent.');
      const number=input.driver_number??row.driver_number,name=input.driver_or_bus_name??row.driver_or_bus_name;
      const bus=input.bus_number===undefined?row.bus_number:input.bus_number;
      if (number===row.driver_number && name===row.driver_or_bus_name && bus===row.bus_number) return;
      await tx.query('UPDATE divyashilla.deliveries SET driver_number=$2,driver_or_bus_name=$3,bus_number=$4,updated_by=$5 WHERE id=$1',
        [id,number,name,bus,actor.id]);await finish(tx,row,actor,'DELIVERY_DRIVER_UPDATED');
    }),
    complete:(id:string,input:CompleteDelivery,actor:DeliveryActor)=>mutate(id,input.version,actor,async(tx,row)=>{
      if (row.delivery_status==='DELIVERED' && row.order_status==='DELIVERED') return;
      readyOrder(row);
      if (row.delivery_status!=='SENT' || !row.driver_number || !row.driver_or_bus_name) conflict('DELIVERY_NOT_SENT','A Sent delivery with driver details is required.');
      await tx.query(`UPDATE divyashilla.deliveries SET delivery_status='DELIVERED',delivered_at=clock_timestamp(),updated_by=$2 WHERE id=$1`,[id,actor.id]);
      await finish(tx,row,actor,'DELIVERY_COMPLETED',undefined,'DELIVERED');
    }),
    issue:(id:string,input:IssueDelivery,actor:DeliveryActor)=>mutate(id,input.version,actor,async(tx,row)=>{
      readyOrder(row);
      if (!['READY_FOR_DELIVERY','SENT','ISSUE'].includes(row.delivery_status)) conflict('INVALID_DELIVERY_TRANSITION','Only a pending delivery can have an issue.');
      if (row.delivery_status==='ISSUE') {
        const current=await read(tx,id,actor);if (current.issue_reason===input.reason) return;
      }
      await tx.query("UPDATE divyashilla.deliveries SET delivery_status='ISSUE',updated_by=$2 WHERE id=$1",[id,actor.id]);
      await finish(tx,row,actor,'DELIVERY_ISSUE_REPORTED',input.reason);
    })
  };
}
