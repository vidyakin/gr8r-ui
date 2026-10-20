/* Единый формат ошибок: { error: { code, message, details?, requestId } }. Тексты — на английском. */
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiError } from '@gr8r/shared';
import type { AppEnv } from './types';

export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 405 | 409 | 422 | 429 | 500,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, 'forbidden', message);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);

/** Откат транзакции арендатора после ответа с ошибкой (не ошибка для клиента) */
export class Rollback extends Error {}

interface PgErrorLike {
  code?: string;
  constraint_name?: string;
  detail?: string;
  column_name?: string;
}

/** Ошибки PostgreSQL → понятные HTTP-ответы. drizzle оборачивает ошибку драйвера в cause */
function fromPg(err: unknown): AppError | null {
  const e = ((err as { cause?: unknown })?.cause ?? err) as PgErrorLike;
  switch (e?.code) {
    case '23505':
      return new AppError(409, 'conflict', 'A record with the same unique value already exists', { constraint: e.constraint_name });
    case '23503':
      return new AppError(422, 'invalid_reference', 'A referenced record does not exist, or the record is still in use', { constraint: e.constraint_name });
    case '23502':
      return new AppError(422, 'missing_value', `A required value is missing${e.column_name ? `: ${e.column_name}` : ''}`);
    case '23514':
      return new AppError(422, 'check_violation', 'A value is out of the allowed range', { constraint: e.constraint_name });
    case '22P02':
    case '22007':
    case '22008':
      return new AppError(400, 'invalid_value', 'A value has an invalid format');
    case '42501': // RLS WITH CHECK или нехватка прав
      return new AppError(403, 'forbidden', 'Operation is not permitted for this workspace');
  }
  return null;
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId');
  let app: AppError | null = null;
  if (err instanceof AppError) app = err;
  else if (err instanceof HTTPException) {
    const status = err.status as AppError['status'];
    app = new AppError(status, status === 404 ? 'not_found' : 'http_error', err.message || 'Request failed');
  } else if (err instanceof SyntaxError) app = new AppError(400, 'invalid_json', 'Request body is not valid JSON');
  else app = fromPg(err);

  if (!app) {
    console.error(`[${requestId}] unhandled error:`, err);
    app = new AppError(500, 'internal_error', 'Internal server error');
  }
  const body: ApiError = { error: { code: app.code, message: app.message, ...(app.details !== undefined ? { details: app.details } : {}), requestId } };
  return c.json(body, app.status);
};

export const onNotFound: NotFoundHandler<AppEnv> = c => {
  const body: ApiError = { error: { code: 'not_found', message: `Route ${c.req.method} ${c.req.path} not found`, requestId: c.get('requestId') } };
  return c.json(body, 404);
};
