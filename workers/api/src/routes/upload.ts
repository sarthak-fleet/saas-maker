import { Hono } from 'hono';
import { requireApiKey } from '../middleware/auth';
import { apiError } from '../lib/errors';
import { storeScreenshot } from '../lib/screenshots';
import { Bindings, Variables } from '../types';

const upload = new Hono<{ Bindings: Bindings; Variables: Variables }>();

upload.post('/', requireApiKey, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return apiError(c, 400, 'invalid_request', 'No file provided');

  const stored = await storeScreenshot(c, file);
  if (stored instanceof Response) return stored;
  return c.json({ url: stored }, 201);
});

export { upload };
