import { timingSafeEqual } from 'node:crypto';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function cloudflareAccessAuthorized(request, { ownerEmail } = {}) {
  const authenticatedEmail = request.headers['cf-access-authenticated-user-email'];
  const accessAssertion = request.headers['cf-access-jwt-assertion'];
  if (
    typeof authenticatedEmail !== 'string'
    || typeof accessAssertion !== 'string'
    || accessAssertion.length < 20
  ) {
    return false;
  }
  return ownerEmail
    ? safeEqual(authenticatedEmail.toLowerCase(), ownerEmail.toLowerCase())
    : true;
}

export function consoleRequestAuthorized(
  request,
  { trustAccessHeaders = false, ownerEmail } = {},
) {
  return !trustAccessHeaders || cloudflareAccessAuthorized(request, { ownerEmail });
}
