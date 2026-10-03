import type { Database } from '../../db/database.js';
import { masterService, type MasterRow } from '../../shared/master-records.js';

export interface SupplierRow extends MasterRow {name: string;phone: string;city: string | null;address: string | null;notes: string | null}
export const supplierService = (db: Database) => masterService<SupplierRow>(db,{
  table:'suppliers',entity:'SUPPLIER',fields:['name','phone','city','address','notes'],
  searchFields:['name','phone','city'],sortFields:['created_at','updated_at','name','city'],
  filters:{city:{column:'city',caseInsensitive:true},phone:{column:'phone'}}
});
