import type { Context } from 'hono';

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'internal_error';

export function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500,
  code: ErrorCode,
  message: string
) {
  return c.json(
    {
      error: {
        code,
        message,
        path: c.req.path,
      },
    },
    status
  );
}
