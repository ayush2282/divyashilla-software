import { z } from 'zod';
export const usernameSchema = z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,64}$/).transform(value => value.toLowerCase());
export const passwordSchema = z.string().min(12).max(128).refine(value => Buffer.byteLength(value,'utf8') <= 512);
export const loginSchema = z.object({username:usernameSchema,password:z.string().min(1).max(128)}).strict();
export const changePasswordSchema = z.object({currentPassword:z.string().min(1).max(128),newPassword:passwordSchema}).strict();
export const createUserSchema = z.object({name:z.string().trim().min(1).max(100),username:usernameSchema,
  role:z.enum(['ADMIN','DELIVERY']),password:passwordSchema}).strict();
