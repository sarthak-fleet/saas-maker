import type { FeedbackSubmission } from './types';

function validateIngestionUrl(ingestionUrl: string): string {
  const trimmedUrl = ingestionUrl.trim();
  if (!trimmedUrl) {
    throw new Error('Feedback ingestion URL cannot be empty.');
  }

  let resolvedUrl: URL;
  try {
    const baseUrl = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI;
    resolvedUrl = new URL(trimmedUrl, baseUrl);
  } catch {
    throw new Error('Feedback ingestion URL is invalid.');
  }

  if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
    throw new Error('Feedback ingestion URL must use HTTP or HTTPS.');
  }

  return trimmedUrl;
}

export async function submitFeedbackToUrl(
  ingestionUrl: string,
  submission: FeedbackSubmission
): Promise<void> {
  const destination = validateIngestionUrl(ingestionUrl);
  const { screenshot, ...feedback } = submission;
  const body = new FormData();
  body.append('feedback', JSON.stringify(feedback));
  if (screenshot) body.append('screenshot', screenshot);

  let response: Response;
  try {
    response = await fetch(destination, {
      method: 'POST',
      credentials: 'omit',
      body,
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Unable to reach the feedback endpoint${detail}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(`Feedback endpoint returned HTTP ${response.status}.`);
  }
}

const DEFAULT_API_BASE = 'https://api.sassmaker.com';

export async function submitFeedbackToProject(
  projectKey: string,
  submission: FeedbackSubmission,
  apiBaseUrl = DEFAULT_API_BASE
): Promise<void> {
  const key = projectKey.trim();
  if (!key) throw new Error('Feedback project key cannot be empty.');

  const base = validateIngestionUrl(apiBaseUrl).replace(/\/$/, '');
  let imageUrl: string | undefined;

  if (submission.screenshot) {
    const upload = new FormData();
    upload.append('file', submission.screenshot);
    const response = await fetch(`${base}/v1/upload`, {
      method: 'POST',
      headers: { 'X-Project-Key': key },
      credentials: 'omit',
      body: upload,
    });
    if (!response.ok) throw new Error(`Feedback image upload returned HTTP ${response.status}.`);
    const result = (await response.json()) as { url?: string };
    imageUrl = result.url;
  }

  const response = await fetch(`${base}/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-Key': key },
    credentials: 'omit',
    body: JSON.stringify({
      type: submission.type,
      title: submission.title,
      description: submission.description,
      submitter_email: submission.email ?? '',
      submitter_name: submission.name,
      image_url: imageUrl,
      page: submission.page,
      anchor: submission.anchor,
    }),
  });
  if (!response.ok) throw new Error(`Feedback service returned HTTP ${response.status}.`);
}
