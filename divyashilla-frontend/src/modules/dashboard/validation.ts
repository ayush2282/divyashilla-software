import { z } from 'zod';
const date=z.iso.date().refine(v=>!v.startsWith('0000-'),'Enter a valid year.').optional();
export const dateRangeSchema=z.object({date_from:date,date_to:date}).refine(v=>!v.date_from||!v.date_to||v.date_from<=v.date_to,{message:'From date must be before or equal to the to date.',path:['date_to']});
