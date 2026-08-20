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

The strip shows only project links and separators. It pauses on hover and
keyboard focus, keeps lists of two or fewer projects static, and disables
motion for visitors who prefer reduced motion. When `currentProjectId` is
known, every outbound link gets `ref=<currentProjectId>` while the catalog URL
remains canonical. Theme values are `light`, `dark`, and `auto`; CSS custom
properties can be overridden on the component. The optional `label` prop names
the region for assistive technology and is not rendered as visible copy.
