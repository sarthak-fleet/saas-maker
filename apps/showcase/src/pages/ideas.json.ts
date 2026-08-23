import ideas from '../data/ideas.json';

export const prerender = true;

export function GET() {
  return new Response(`${JSON.stringify(ideas)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
