import type { PageMeta } from '../../api/types';
export const orderStatuses=['NEW','IN_WORK','READY_FOR_DELIVERY','DELIVERED','CANCELLED'] as const;
export type OrderStatus=typeof orderStatuses[number];
export interface Order {
  id:string;order_number:string;version:number;order_status:OrderStatus;
  order_date:string;expected_delivery_date:string|null;customer_id:string;design_id:string;supplier_id:string|null;
  selling_price:string;buying_price:string|null;advance_amount:string;additional_work:string|null;
  delivery_name:string;delivery_phone:string;delivery_city:string;delivery_address:string|null;
  design_number_snapshot:string;design_name_snapshot:string;size_snapshot:string;material_snapshot:string;
  created_at:string;updated_at:string;
}
export interface OrderDetail extends Order {
  customer_net_received:string;balance_amount:string;delivery_expense:string;other_expense:string;profit:string|null;actual_delivery_date:string|null;
}
export interface OrdersPage {data:Order[];meta:PageMeta}
export const statusLabel:Record<OrderStatus,string>={NEW:'New',IN_WORK:'In work',READY_FOR_DELIVERY:'Ready for delivery',DELIVERED:'Delivered',CANCELLED:'Cancelled'};
export const closed=(status:OrderStatus)=>status==='DELIVERED'||status==='CANCELLED';
export function nextStatus(status:OrderStatus):OrderStatus|null {return status==='NEW'?'IN_WORK':status==='IN_WORK'?'READY_FOR_DELIVERY':status==='READY_FOR_DELIVERY'?'DELIVERED':null;}
