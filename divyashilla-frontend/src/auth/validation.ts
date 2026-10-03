import { z } from 'zod';
export const loginSchema=z.object({username:z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,64}$/,'Enter a valid username (3–64 letters, numbers, dots, dashes or underscores).').transform(v=>v.toLowerCase()),password:z.string().min(1,'Enter your password.').max(128)});
export const passwordSchema=z.object({currentPassword:z.string().min(1,'Enter your current password.').max(128),
  newPassword:z.string().min(12,'Use at least 12 characters.').max(128,'Use at most 128 characters.').refine(value=>new TextEncoder().encode(value).length<=512,'Password is too long.'),
  confirmPassword:z.string().min(1,'Confirm your new password.')}).refine(value=>value.currentPassword!==value.newPassword,{message:'Choose a different new password.',path:['newPassword']}).refine(value=>value.newPassword===value.confirmPassword,{message:'Passwords do not match.',path:['confirmPassword']});
