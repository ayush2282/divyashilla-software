import type { Database } from '../../db/database.js';
import { masterService, type MasterRow } from '../../shared/master-records.js';

export interface CustomerRow extends MasterRow {name: string;phone: string;city: string;address: string | null;notes: string | null}
export const customerService = (db: Database) => masterService<CustomerRow>(db,{
  table:'customers',entity:'CUSTOMER',fields:['name','phone','city','address','notes'],
  searchFields:['name','phone','city'],sortFields:['created_at','updated_at','name','city'],
  filters:{city:{column:'city',caseInsensitive:true},phone:{column:'phone'}}
});
