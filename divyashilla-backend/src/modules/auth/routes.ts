import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../../config.js';
import type { Database } from '../../db/database.js';
import { authService } from './service.js';
import { requireAuth, requireCsrf } from './middleware.js';
import { csrfToken, clearSessionCookie, setSessionCookie } from './sessions.js';
import { changePasswordSchema, loginSchema } from './validation.js';

export function authRoutes(db: Database, config: Config) {
  const router = Router();
  const service = authService(db,config);
  const authenticate = requireAuth(db,config);
  const csrf = requireCsrf(config);
  const loginLimit = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,
    message:{error:{code:'LOGIN_RATE_LIMIT',message:'Too many login attempts. Try again later.'}}});
  const passwordLimit = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,
    message:{error:{code:'PASSWORD_RATE_LIMIT',message:'Too many password-change attempts. Try again later.'}}});

  router.post('/login',loginLimit,async (req,res) => {
    const body = loginSchema.parse(req.body);
    const previous: unknown = req.cookies?.[config.cookieName];
    const result = await service.login(body.username,body.password,req.requestId,typeof previous === 'string' ? previous : undefined);
    setSessionCookie(res,config,result.session);
    res.json({user:result.user,csrfToken:csrfToken(result.session.token,config.CSRF_SECRET),expiresAt:result.session.expiresAt});
  });
  router.get('/me',authenticate,(req,res) => {
    res.json({user:req.auth!.user,csrfToken:csrfToken(req.auth!.rawToken,config.CSRF_SECRET),expiresAt:req.auth!.expiresAt});
  });
  router.post('/logout',authenticate,csrf,async (req,res) => {
    await service.logout(req.auth!,req.requestId);
    clearSessionCookie(res,config);
    res.status(204).end();
  });
  router.post('/change-password',authenticate,csrf,passwordLimit,async (req,res) => {
    const body = changePasswordSchema.parse(req.body);
    const result = await service.changePassword(req.auth!,body.currentPassword,body.newPassword,req.requestId);
    setSessionCookie(res,config,result.session);
    res.json({user:result.user,csrfToken:csrfToken(result.session.token,config.CSRF_SECRET),expiresAt:result.session.expiresAt});
  });
  return router;
}
