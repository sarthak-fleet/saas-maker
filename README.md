# `@saas-maker/portfolio-project-strip`

A small, backend-free React footer strip that quietly connects a product to an
author's other current projects.

The canonical project source for both internal and external project truth is
Fleet's `foundry/ops/config/projects.json`; the endpoint and package catalog
are generated safe projections, never hand-maintained copies.
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

The JSON endpoint returns the public project catalog: `{ id, name, url,
description, tier, priority, category, maturity, spotlight, pillarId,
domains }`. URLs must be absolute HTTP(S) URLs. You can also pass `projects`
directly for a fully static integration.

The strip pauses on hover and keyboard focus, exposes a Pause/Resume control,
uses real links, keeps lists of two or fewer projects static, and disables
motion for visitors who prefer reduced motion. Theme values are `light`,
`dark`, and `auto`; CSS custom properties can be overridden on the component.
