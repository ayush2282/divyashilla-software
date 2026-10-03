import { mountFrontend } from './frontend.js';
import { reportRoutes } from './modules/reports/routes.js';
import type { PrivateStorage } from './storage/types.js';
import { localStorage } from './storage/local.js';
import { fileRoutes } from './modules/files/routes.js';
import { deliveryRoutes } from './modules/delivery/routes.js';
import { customerPaymentRoutes } from './modules/customer-payments/routes.js';
import { supplierPaymentRoutes } from './modules/supplier-payments/routes.js';
import { expenseRoutes } from './modules/order-expenses/routes.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Config } from './config.js';
import type { Database } from './db/database.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './modules/auth/routes.js';
import { requireAuth, requireRoles, requireTrustedOrigin } from './modules/auth/middleware.js';
import { healthRoutes } from './modules/health/routes.js';
import { AppError } from './shared/errors.js';
import { customerRoutes } from './modules/customers/routes.js';
import { designRoutes } from './modules/designs/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { supplierRoutes } from './modules/suppliers/routes.js';

export function createApp(db: Database, config: Config, storage:PrivateStorage=localStorage(config.FILES_DIRECTORY)) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy',config.TRUST_PROXY_HOPS);
  app.use((req,res,next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id',req.requestId);
    res.setHeader('Cache-Control','no-store');
    next();
  });
  app.use(helmet());
  app.use(cors({credentials:true,origin:(origin,callback) => {
    if (!origin || config.allowedOrigins.includes(origin)) callback(null,Boolean(origin));
    else callback(new AppError(403,'UNTRUSTED_ORIGIN','Use an allowed application origin.'));
  }}));
  app.use(express.json({limit:'16kb'}));
  app.use(cookieParser());
  app.use('/api/v1',rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,
    message:{error:{code:'RATE_LIMIT',message:'Too many requests. Try again later.'}}}));
  app.use('/api/v1',requireTrustedOrigin(config));
  app.use('/api/v1/auth',authRoutes(db,config));
  app.use('/api/v1/customers',customerRoutes(db,config));
  app.use('/api/v1/designs',designRoutes(db,config));
  app.use('/api/v1/suppliers',supplierRoutes(db,config));
  app.use('/api/v1/orders',orderRoutes(db,config));
  app.use('/api/v1/customer-payments',customerPaymentRoutes(db,config));
  app.use('/api/v1/supplier-payments',supplierPaymentRoutes(db,config));
  app.use('/api/v1/order-expenses',expenseRoutes(db,config));
  app.use('/api/v1/deliveries',deliveryRoutes(db,config));
  app.use('/api/v1/files',fileRoutes(db,config,storage));
  app.use('/api/v1/reports',reportRoutes(db,config));
  app.use('/health',healthRoutes(db));
  // These small endpoints verify middleware. They expose no business records.
  app.get('/api/v1/access/admin',requireAuth(db,config),requireRoles('ADMIN'),(_req,res) => res.json({allowed:true,role:'ADMIN'}));
  app.get('/api/v1/access/delivery',requireAuth(db,config),requireRoles('ADMIN','DELIVERY'),(_req,res) => res.json({allowed:true}));
  mountFrontend(app,config.FRONTEND_DIRECTORY);
  app.use((_req,_res) => { throw new AppError(404,'NOT_FOUND','API endpoint not found.'); });
  app.use(errorHandler);
  return app;
}
