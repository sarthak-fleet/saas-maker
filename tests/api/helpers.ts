import app from '../../workers/api/src/index';

// Hono's app.request() lets us test without a running server.
// Mock bindings are provided so the app can initialize. For tests that
// check auth guards or missing headers, the middleware rejects BEFORE
// touching the DB, so no real connection is needed.
export function request(path: string, init?: RequestInit, env?: Record<string, unknown>) {
  return app.request(path, init, {
    APP_BASE_URL: 'http://localhost:3000',
    CORS_ORIGIN: '*',
    DATABASE_URL: 'postgresql://localhost:26257/test',
    FEEDBACK_IMAGES: { put: async () => undefined } as any,
    RESEND_API_KEY: 'test',
    NOTIFICATION_FROM_EMAIL: 'test@test.com',
    ...env,
  });
}
