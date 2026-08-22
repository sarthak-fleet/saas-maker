import { apiError } from './errors';
import type { AppContext } from '../types';

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export async function storeScreenshot(c: AppContext, file: File): Promise<string | Response> {
  if (!ALLOWED_SCREENSHOT_TYPES.includes(file.type)) {
    return apiError(c, 415, 'invalid_request', 'Invalid file type. Allowed: jpeg, png, gif, webp');
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return apiError(c, 413, 'invalid_request', 'File too large. Max 5MB');
  }

  const ext = file.type.split('/')[1];
  const key = `feedback/${crypto.randomUUID()}.${ext}`;
  await c.env.FEEDBACK_IMAGES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
  return `https://images.sassmaker.com/${key}`;
}
