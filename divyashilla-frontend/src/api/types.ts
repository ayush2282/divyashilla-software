export type Role='ADMIN'|'DELIVERY';
export interface User {id:string;name:string;username:string;role:Role;mustChangePassword:boolean}
export interface Session {user:User;csrfToken:string;expiresAt:string}
export interface PageMeta {page:number;limit:number;total:number;total_pages:number}
export interface MasterRecord {id:string;is_active:boolean;created_at:string;updated_at:string;[key:string]:string|boolean|null}
export interface PageResult {data:MasterRecord[];meta:PageMeta}
export interface DashboardSummary {
  total_orders:number;cancelled_orders:number;pending_delivery:number;delivery_issues:number;
  payment_pending_orders:number;payment_pending_amount:string;sales:string;known_profit:string;unpriced_orders:number;
  monthly_sales:string;monthly_known_profit:string;monthly_unpriced_orders:number;
  supplier_payment_pending_amount:string;supplier_payment_pending_suppliers:number;
}
