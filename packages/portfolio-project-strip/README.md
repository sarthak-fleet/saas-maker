# `@saas-maker/portfolio-project-strip`

A small, backend-free React footer strip that quietly connects a product to an
author's other current projects.

Fleet's private catalog remains the canonical project source. SaaS Maker checks
in its allowlisted projection at `catalog/generated/public.json`; both the site
endpoint and this package catalog are generated from that same safe JSON rather
than maintaining another project list.
It includes a generated Fleet catalog for instant first paint. By default it
revalidates against the cached `https://sassmaker.com/projects.json` endpoint
after mount with an 800ms timeout and keeps the bundled list if the request
fails. Pass `catalogUrl=""` to disable network revalidation.

```tsx
import { PortfolioProjectStrip } from '@saas-maker/portfolio-project-strip'
import '@saas-maker/portfolio-project-strip/dist/index.css'

export function FooterStrip() {
  return (
    <PortfolioProjectStrip
      currentProjectId="codevetter"
    />
  )
}
```

## Browser-native integration

Astro, static HTML, and non-React consumers can load the custom-element
entrypoint:

```html
<script type="module" src="/vendor/portfolio-project-strip/element.js"></script>
<portfolio-project-strip current-project="codevetter"></portfolio-project-strip>
```

Bundler-based consumers can import
`@saas-maker/portfolio-project-strip/browser`. The browser element accepts
`current-project`, `catalog-url`, `label`, `theme`, and `speed`. It renders the
bundled public catalog immediately and keeps it when the bounded background
refresh fails.

The project strip is a standalone, opt-in discovery component. The hosted AI
footer no longer composes it into the shared bottom dock.

The JSON endpoint returns the public project catalog: `{ id, name, url,
description, tier, priority, category, maturity, spotlight, pillarId,
domains }`. URLs must be absolute HTTP(S) URLs. You can also pass `projects`
directly for a fully static integration.

The strip shows only project links and separators. It pauses on hover and
keyboard focus, keeps lists of two or fewer projects static, and disables
motion for visitors who prefer reduced motion. When `currentProjectId` is
known, every outbound link gets `ref=<currentProjectId>` while the catalog URL
remains canonical. Theme values are `light`, `dark`, and `auto`; CSS custom
properties can be overridden on the component. The optional `label` prop names
the region for assistive technology and is not rendered as visible copy.
