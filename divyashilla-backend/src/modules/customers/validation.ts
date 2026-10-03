import { z } from 'zod';
import { listFields, nullableText, phoneSchema, requiredText } from '../../shared/master-validation.js';

const fields = {name:requiredText(120),phone:phoneSchema,city:requiredText(100),
  address:nullableText(1000),notes:nullableText(2000)};
export const createCustomerSchema = z.object({...fields,address:fields.address.default(null),notes:fields.notes.default(null)}).strict();
export const updateCustomerSchema = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0,'Provide at least one field.');
export const customerListSchema = z.object({...listFields,
  sort_by:z.enum(['created_at','updated_at','name','city']).default('created_at'),
  city:requiredText(100).optional(),phone:phoneSchema.optional()}).strict();
