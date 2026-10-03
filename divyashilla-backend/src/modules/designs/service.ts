import type { Database } from '../../db/database.js';
import { masterService, type MasterRow } from '../../shared/master-records.js';
import { AppError } from '../../shared/errors.js';

export interface DesignRow extends MasterRow {design_number: string;design_name: string;size: string;material: string;notes: string | null;image_file_id: string | null}
export const designService = (db: Database) => masterService<DesignRow>(db,{
  table:'designs',entity:'DESIGN',fields:['design_number','design_name','size','material','notes','image_file_id'],
  searchFields:['design_number','design_name','size','material'],sortFields:['created_at','updated_at','design_number','design_name','size','material'],
  filters:{material:{column:'material',caseInsensitive:true},size:{column:'size',caseInsensitive:true},design_number:{column:'design_number'}},
  validateUpdate:async (tx,id,input) => {
    if (typeof input.image_file_id !== 'string') return;
    const file = await tx.query(`SELECT id FROM divyashilla.files WHERE id = $1 AND design_id = $2
      AND category = 'DESIGN_IMAGE' AND state = 'ACTIVE' AND mime_type LIKE 'image/%' FOR SHARE`,[input.image_file_id,id]);
    if (file.rows.length !== 1) throw new AppError(400,'INVALID_DESIGN_IMAGE','Choose an active product image belonging to this design.');
  }
});
