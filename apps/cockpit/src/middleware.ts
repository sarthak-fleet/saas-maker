import { isLocalAuthBypassEnabled } from '@/lib/local-auth-edge';
import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => Boolean(req.cookies.get(name)?.value));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isLocalAuthBypassEnabled(req.headers.get('host'))) {
    return NextResponse.next();
  }

  // Do not call better-auth here. Middleware runs on the Edge isolate and
  // getCloudflareContext()/D1 are unavailable, which 500s /projects.
  if (!hasSessionCookie(req)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/token', '/projects', '/projects/:path*'],
};
