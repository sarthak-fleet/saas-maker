export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(prefix: string, bytes = 24): string {
  const entropy = new Uint8Array(bytes);
  crypto.getRandomValues(entropy);
  return (
    prefix +
    Array.from(entropy)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  );
}
