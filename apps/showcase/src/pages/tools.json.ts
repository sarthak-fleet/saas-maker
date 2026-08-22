import { TOOLING_CAPABILITIES } from '../data/tooling';

export const prerender = true;

export function GET() {
  return new Response(
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedFrom: 'sass-maker/saas-maker/tooling',
        count: TOOLING_CAPABILITIES.length,
        capabilities: TOOLING_CAPABILITIES,
      },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
}
