import { z } from 'zod';
import { listFields,phoneSchema,requiredText } from '../../shared/master-validation.js';
const version=z.number().int().min(1).max(2147483646);
const busNumber=z.string().trim().max(100).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'Control characters are not allowed.')
  .nullable().transform(value=>value===''?null:value);
const driverFields={driver_number:phoneSchema,driver_or_bus_name:requiredText(200),bus_number:busNumber.optional()};
export const sendDeliverySchema=z.object({version,...driverFields}).strict();
export const driverUpdateSchema=z.object(driverFields).partial().extend({version}).strict()
  .refine(value=>Object.keys(value).length>1,'Supply at least one driver field.');
export const completeDeliverySchema=z.object({version}).strict();
export const issueDeliverySchema=z.object({version,reason:requiredText(500)}).strict();
export const assignDeliverySchema=z.object({version,assigned_delivery_user_id:z.string().uuid().nullable(),reason:requiredText(500)}).strict();
export const deliveryListSchema=z.object({page:listFields.page,limit:listFields.limit,q:listFields.q,sort_order:listFields.sort_order,
  sort_by:z.enum(['order_number','expected_delivery_date','delivery_updated_at']).default('expected_delivery_date'),
  delivery_status:z.enum(['NOT_ASSIGNED','READY_FOR_DELIVERY','SENT','DELIVERED','ISSUE']).optional(),
  assigned_delivery_user_id:z.string().uuid().optional(),expected_from:z.iso.date().optional(),expected_to:z.iso.date().optional()
}).strict().refine(value=>!value.expected_from || !value.expected_to || value.expected_from<=value.expected_to,'Invalid date range.');
export type SendDelivery=z.infer<typeof sendDeliverySchema>;
export type DriverUpdate=z.infer<typeof driverUpdateSchema>;
export type CompleteDelivery=z.infer<typeof completeDeliverySchema>;
export type IssueDelivery=z.infer<typeof issueDeliverySchema>;
export type AssignDelivery=z.infer<typeof assignDeliverySchema>;
export type DeliveryList=z.infer<typeof deliveryListSchema>;

// Minimal ADMIN lookup for the frontend assignment selector.
export const assigneeListSchema=z.object({page:listFields.page,limit:listFields.limit,q:listFields.q,id:z.string().uuid().optional()}).strict();
export type AssigneeList=z.infer<typeof assigneeListSchema>;
