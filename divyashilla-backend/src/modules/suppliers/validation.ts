import { z } from 'zod';
import { listFields, nullableText, phoneSchema, requiredText } from '../../shared/master-validation.js';

const fields = {name:requiredText(120),phone:phoneSchema,city:nullableText(100),address:nullableText(1000),notes:nullableText(2000)};
export const createSupplierSchema = z.object({...fields,city:fields.city.default(null),address:fields.address.default(null),notes:fields.notes.default(null)}).strict();
export const updateSupplierSchema = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0,'Provide at least one field.');
export const supplierListSchema = z.object({...listFields,
  sort_by:z.enum(['created_at','updated_at','name','city']).default('created_at'),
  city:requiredText(100).optional(),phone:phoneSchema.optional()}).strict();
