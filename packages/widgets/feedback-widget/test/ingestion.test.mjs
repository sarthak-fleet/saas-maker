import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { submitFeedbackToProject, submitFeedbackToUrl } from '../dist/index.mjs';

function submission(overrides = {}) {
  return {
    type: 'feedback',
    title: 'Clear title',
    description: 'Useful details',
    page: {
      url: 'https://product.example/settings',
      title: 'Settings',
    },
    ...overrides,
  };
}

test('posts one stable multipart request without browser credentials', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const screenshot = new File(['image bytes'], 'screen.png', { type: 'image/png' });
  let request = null;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(null, { status: 204 });
  };

  await submitFeedbackToUrl('/api/feedback', submission({ screenshot }));

  assert.equal(request.url, '/api/feedback');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.headers, undefined);
  assert.equal(request.init.body instanceof FormData, true);

  const payload = JSON.parse(request.init.body.get('feedback'));
  assert.deepEqual(payload, submission());
  assert.equal(request.init.body.get('screenshot').name, 'screen.png');
});

test('uses the same multipart contract when no screenshot is present', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = init.body;
    return new Response(null, { status: 200 });
  };

  await submitFeedbackToUrl('https://feedback.example/ingest', submission());

  assert.deepEqual(JSON.parse(body.get('feedback')), submission());
  assert.equal(body.has('screenshot'), false);
});

test('rejects non-HTTP destinations before sending', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(null, { status: 204 });
  };

  await assert.rejects(
    submitFeedbackToUrl('javascript:alert(1)', submission()),
    /must use HTTP or HTTPS/
  );
  assert.equal(requests, 0);
});

test('reports a non-2xx response after exactly one request', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(null, { status: 429 });
  };

  await assert.rejects(submitFeedbackToUrl('/api/feedback', submission()), /returned HTTP 429/);
  assert.equal(requests, 1);
});

test('turns network failures into actionable endpoint errors without retrying', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('offline');
  };

  await assert.rejects(
    submitFeedbackToUrl('/api/feedback', submission()),
    /Unable to reach the feedback endpoint: offline/
  );
  assert.equal(requests, 1);
});

test('hosted mode sends one multipart request with the project key', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return Response.json({ id: 'feedback_1' }, { status: 201 });
  };

  const screenshot = new File(['image bytes'], 'screen.png', { type: 'image/png' });
  await submitFeedbackToProject(
    'feedback_public_example',
    submission({ screenshot, email: 'person@example.com', name: 'Person' }),
    'https://feedback.example/'
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://feedback.example/v1/feedback');
  assert.equal(requests[0].init.headers['X-Project-Key'], 'feedback_public_example');
  assert.equal(requests[0].init.body instanceof FormData, true);
  const payload = JSON.parse(requests[0].init.body.get('feedback'));
  assert.equal(payload.submitter_email, 'person@example.com');
  assert.equal(payload.source, 'widget');
  assert.deepEqual(payload.page, submission().page);
  assert.equal(requests[0].init.body.get('screenshot').name, 'screen.png');
});

test('reports the published package version to the server', async (t) => {
  // CLIENT_VERSION is hand-maintained next to the package version, so a
  // release that bumps one and forgets the other silently mislabels every
  // submission's origin. Pin them together.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = init.body;
    return new Response(JSON.stringify({ id: 'fb_1' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await submitFeedbackToProject('proj_test', submission());

  assert.equal(JSON.parse(sent.get('feedback')).client_version, pkg.version);
});
