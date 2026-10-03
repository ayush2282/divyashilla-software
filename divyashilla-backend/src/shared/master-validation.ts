import { z } from 'zod';

// Names/codes remain Unicode-friendly, including Marathi. Free text may contain
// newlines, but PostgreSQL text cannot contain a NUL character.
export const requiredText = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value),'Control characters are not allowed.');
export const nullableText = (max: number) => z.string().trim().max(max)
  .refine(value => !value.includes('\u0000'),'NUL characters are not allowed.')
  .nullable().transform(value => value === '' ? null : value);
export const phoneSchema = z.string().trim().min(1).max(40)
  .transform(value => value.replace(/[\s()-]/g,''))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/,'Use 7–15 digits, optionally starting with +.'));
export const idParamsSchema = z.object({id:z.string().uuid()}).strict();
export const statusChangeSchema = z.object({reason:requiredText(500)}).strict();

const queryInteger = (max: number) => z.string().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().min(1).max(max));
export const listFields = {
  page:queryInteger(100000).default(1),
  limit:queryInteger(100).default(20),
  q:z.string().trim().max(100).refine(value => !value.includes('\u0000')).default(''),
  status:z.enum(['active','inactive','all']).default('active'),
  sort_order:z.enum(['asc','desc']).default('desc')
};
