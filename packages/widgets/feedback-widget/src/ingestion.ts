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
const CLIENT_VERSION = '0.4.1';

export async function submitFeedbackToProject(
  projectKey: string,
  submission: FeedbackSubmission,
  apiBaseUrl = DEFAULT_API_BASE
): Promise<void> {
  const key = projectKey.trim();
  if (!key) throw new Error('Feedback project key cannot be empty.');

  const base = validateIngestionUrl(apiBaseUrl).replace(/\/$/, '');
  const { screenshot, ...feedback } = submission;
  const body = new FormData();
  body.append(
    'feedback',
    JSON.stringify({
      type: feedback.type,
      title: feedback.title,
      description: feedback.description,
      submitter_email: feedback.email ?? '',
      submitter_name: feedback.name,
      page: feedback.page,
      anchor: feedback.anchor,
      source: 'widget',
      client_version: CLIENT_VERSION,
    })
  );
  if (screenshot) body.append('screenshot', screenshot);

  let response: Response;
  try {
    response = await fetch(`${base}/v1/feedback`, {
      method: 'POST',
      headers: { 'X-Project-Key': key },
      credentials: 'omit',
      body,
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Unable to reach the feedback service${detail}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Feedback service returned HTTP ${response.status}.`);
}
