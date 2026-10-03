import type { PageMeta } from '../../api/types';
export const deliveryStatuses=['NOT_ASSIGNED','READY_FOR_DELIVERY','SENT','DELIVERED','ISSUE'] as const;
export type DeliveryStatus=typeof deliveryStatuses[number];
// Safe delivery contract only: never fetch an order/financial/master row here.
export interface Delivery {
  delivery_id:string;order_id:string;order_number:string;order_date:string;order_status:string;assigned_delivery_user_id:string|null;version:number;
  customer_name:string;customer_phone:string;customer_city:string;customer_address:string|null;
  design_number:string;design_name:string;size:string;material:string;additional_work:string|null;
  expected_delivery_date:string|null;delivery_status:DeliveryStatus;driver_number:string|null;driver_or_bus_name:string|null;bus_number:string|null;
  delivered_at:string|null;updated_by:string;delivery_updated_at:string;issue_reason:string|null;
}
export interface DeliveriesPage {data:Delivery[];meta:PageMeta}
export interface Assignee {id:string;name:string;username:string}
export interface AssigneesPage {data:Assignee[];meta:PageMeta}
export const deliveryLabel:Record<DeliveryStatus,string>={NOT_ASSIGNED:'Not assigned',READY_FOR_DELIVERY:'Ready for delivery',SENT:'Sent',DELIVERED:'Delivered',ISSUE:'Issue'};
export const canUpdate=(row:Delivery)=>row.order_status==='READY_FOR_DELIVERY'&&['READY_FOR_DELIVERY','SENT','ISSUE'].includes(row.delivery_status);
