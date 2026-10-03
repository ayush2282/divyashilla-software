import type { SqlExecutor } from '../../db/database.js';

type SafeValue = string | number | boolean | null;
export interface ActivityEntry {
  actorId: string | null; action: string; entityType: string; entityId?: string;
  before?: Record<string, SafeValue>; after?: Record<string, SafeValue>;
  reason?: string; requestId?: string;
}

// Explicit safe fields, not full request/user/session objects. Do not log secrets.
const safeKeys = new Set(['report_type','row_count','date_from','date_to','id','name','username','role','isActive','mustChangePassword','revokedSessions',
  'phone','city','address','notes','design_number','design_name','size','material','image_file_id','is_active',
  'order_number','order_status','version','customer_id','design_id','supplier_id','order_date','expected_delivery_date',
  'additional_work','buying_price','selling_price','advance_amount','delivery_name','delivery_phone','delivery_city','delivery_address',
  'design_number_snapshot','design_name_snapshot','size_snapshot','material_snapshot','design_image_file_id','delivery_status',
  'order_id','supplier_payment_id','amount','direction','purpose','category','payment_date','expense_date','payment_method',
  'note','status','received_by','paid_by','processed_by','created_by','void_reason','voided_by','assigned_delivery_user_id','driver_number','driver_or_bus_name','bus_number','delivered_at','mime_type','size_bytes','state','customer_payment_id','expense_id']);
export async function writeActivity(tx: SqlExecutor, entry: ActivityEntry) {
  for (const data of [entry.before, entry.after]) {
    if (data && Object.keys(data).some(key => !safeKeys.has(key))) throw new Error('Unsafe activity-log field. Extend the allowlist deliberately.');
  }
  await tx.query(`INSERT INTO divyashilla.activity_logs
    (actor_user_id, action, entity_type, entity_id, before_data, after_data, reason, request_id)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`, [entry.actorId,entry.action,entry.entityType,entry.entityId ?? null,
    entry.before ? JSON.stringify(entry.before) : null,entry.after ? JSON.stringify(entry.after) : null,entry.reason ?? null,entry.requestId ?? null]);
}
