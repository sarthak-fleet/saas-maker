import { PUBLIC_ROUTES } from '../data/publicRoutes';

export const prerender = true;

export function GET() {
  const home = PUBLIC_ROUTES.find((route) => route.path === '/');
  if (!home) return new Response('Not found\n', { status: 404 });
  return new Response(home.markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
