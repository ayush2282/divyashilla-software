import type { PageMeta } from '../../api/types';
export const fileCategories=['DESIGN_IMAGE','ORDER_PRODUCT_IMAGE','ORDER_DOCUMENT','CUSTOMER_PAYMENT_DOCUMENT','SUPPLIER_PAYMENT_DOCUMENT','EXPENSE_DOCUMENT'] as const;
export type FileCategory=typeof fileCategories[number];
export type FileOwner={design_id:string}|{order_id:string}|{customer_payment_id:string}|{supplier_payment_id:string}|{expense_id:string};
export type OwnerKey='design_id'|'order_id'|'customer_payment_id'|'supplier_payment_id'|'expense_id';
export interface PrivateFile {id:string;original_name:string;mime_type:string;size_bytes:string;category:FileCategory;state:string;created_at:string;updated_at:string;order_id:string|null}
export interface FilesPage {data:PrivateFile[];meta:PageMeta}
export const ownerCategories:Record<OwnerKey,FileCategory[]>={design_id:['DESIGN_IMAGE'],order_id:['ORDER_PRODUCT_IMAGE','ORDER_DOCUMENT'],customer_payment_id:['CUSTOMER_PAYMENT_DOCUMENT'],supplier_payment_id:['SUPPLIER_PAYMENT_DOCUMENT'],expense_id:['EXPENSE_DOCUMENT']};
export const categoryLabel:Record<FileCategory,string>={DESIGN_IMAGE:'Design image',ORDER_PRODUCT_IMAGE:'Product photo',ORDER_DOCUMENT:'Delivery-safe order document',CUSTOMER_PAYMENT_DOCUMENT:'Customer payment document',SUPPLIER_PAYMENT_DOCUMENT:'Supplier payment document',EXPENSE_DOCUMENT:'Expense document'};
