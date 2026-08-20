import { Context } from 'hono';

export type Bindings = {
  APP_BASE_URL: string;
  CORS_ORIGIN: string;
  DB: D1Database;
  FEEDBACK_IMAGES: R2Bucket;
  RATE_LIMITER?: { limit: (input: { key: string }) => Promise<{ success: boolean }> };
  LOCAL_AUTH_BYPASS?: string;
  SAASMAKER_LOCAL_SESSION_TOKEN?: string;
};

export type Variables = {
  requestId: string;
  userId?: string;
  projectId?: string;
  project?: any;
};

export type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
