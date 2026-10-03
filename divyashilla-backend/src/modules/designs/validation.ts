import { z } from 'zod';
import { listFields, nullableText, requiredText } from '../../shared/master-validation.js';

const fields = {design_number:requiredText(40),design_name:requiredText(120),size:requiredText(80),material:requiredText(80),notes:nullableText(2000)};
export const createDesignSchema = z.object({...fields,notes:fields.notes.default(null)}).strict();
// Photos are private file references, not arbitrary public URLs. An existing
// ACTIVE image owned by this design may be attached after the design exists.
export const updateDesignSchema = z.object({...fields,image_file_id:z.string().uuid().nullable()})
  .partial().strict().refine(value => Object.keys(value).length > 0,'Provide at least one field.');
export const designListSchema = z.object({...listFields,
  sort_by:z.enum(['created_at','updated_at','design_number','design_name','size','material']).default('created_at'),
  material:requiredText(80).optional(),size:requiredText(80).optional(),design_number:requiredText(40).optional()}).strict();
