import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';

export const errorHandler: ErrorRequestHandler = (error: unknown,req,res,_next) => {
  if (error instanceof ZodError) {
    res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Check the submitted fields.',
      fields:[...new Set(error.issues.map(issue => issue.path.join('.')))]},requestId:req.requestId});
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({error:{code:error.code,message:error.message},requestId:req.requestId}); return;
  }
  const details = error as {status?: number; code?: string; type?: string} | null;
  if (details?.type === 'entity.parse.failed') {
    res.status(400).json({error:{code:'INVALID_JSON',message:'Send valid JSON.'},requestId:req.requestId}); return;
  }
  if (details?.status === 413) {
    res.status(413).json({error:{code:'BODY_TOO_LARGE',message:'Request is too large.'},requestId:req.requestId}); return;
  }
  // Do not log request bodies, cookies, SQL, database URLs, or stack traces.
  console.error(JSON.stringify({event:'request_failed',requestId:req.requestId}));
  res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Something went wrong. Try again later.'},requestId:req.requestId});
};
