// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://sassmaker.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    // `file` keeps slashless canonicals mapping straight onto `/learnings.html`
    // on Cloudflare Pages. `directory` would emit `learnings/index.html` and
    // make Pages 308-redirect `/learnings` to `/learnings/`, which contradicts
    // `trailingSlash: 'never'` and the canonical URLs this site publishes.
    // HEAD parity (issue #93) is handled in `functions/_middleware.ts`, which
    // was the actual cause: it resolved HEAD against an empty body and its
    // soft-404 detector then rejected every interior page.
    format: 'file',
    inlineStylesheets: 'always',
  },
});
