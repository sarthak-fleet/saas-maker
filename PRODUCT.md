# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

React product teams embedding a compact portfolio link surface, and visitors
who reach the end of one product and want to discover related work without
leaving the current page flow.

## Product Purpose

Provide one backend-free component that renders current public Fleet projects
immediately, excludes the current product, and optionally refreshes from a
cacheable public catalog after first paint.

## Positioning

The package combines a bundled safe projection of Fleet's canonical project
registry with optional background revalidation. Consumers get a useful,
crawlable first render without operating a service or waiting on a request.

## Operating Context

The strip is embedded near a product footer. Consumers import the React
component and its stylesheet, identify the current project, and may override
its project list, label, theme, speed, or catalog URL.

## Capabilities and Constraints

- `foundry/ops/config/projects.json` remains the canonical project record.
- The package contains no credentials, analytics, storage, default backend, or
  Fleet-hosted runtime.
- The public catalog exposes only the documented safe project projection.
- Publishing and product-by-product adoption are separate explicit actions.
- Links remain semantic and usable when revalidation, animation, or JavaScript
  is unavailable.

## Evidence on Hand

The OpenSpec change in
`foundry/openspec/changes/add-portfolio-project-strip/` defines the product
requirements, loading contract, and accessibility scenarios. The generated
catalog and public endpoint are both derived from the canonical Fleet registry.

## Product Principles

- Render useful content before making a request.
- Fail quietly while retaining the last valid catalog.
- Keep integration optional, themeable, and backend-free.
- Make discovery accessible without turning the footer into a directory.

## Accessibility & Inclusion

Links must remain keyboard reachable and screen-reader named. Moving content
must pause for interaction, expose an explicit pause control, and become static
under `prefers-reduced-motion`.
