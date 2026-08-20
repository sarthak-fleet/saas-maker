import { portfolioProjects } from '../lib/portfolio-projects';

export function GET() {
  return new Response(JSON.stringify(portfolioProjects), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
