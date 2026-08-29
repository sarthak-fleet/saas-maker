export const prerender = true;

export function GET() {
  return new Response(
    JSON.stringify(
      {
        specVersion: '1.0',
        host: {
          displayName: 'SaaS Maker',
          identifier: 'did:web:sassmaker.com',
        },
        entries: [
          {
            identifier: 'urn:air:sassmaker.com:catalog:public-directory',
            displayName: 'SaaS Maker public directory',
            type: 'application/json',
            url: 'https://sassmaker.com/api/ai',
          },
          {
            identifier: 'urn:air:sassmaker.com:tooling:capabilities',
            displayName: 'SaaS Maker reusable tooling catalog',
            type: 'application/json',
            url: 'https://sassmaker.com/tools.json',
          },
        ],
      },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/ai-catalog+json; charset=utf-8' } }
  );
}
