# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

React and browser-native product teams embedding a compact portfolio link surface, and visitors
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

The strip is embedded near a product footer. React consumers import the
component and its stylesheet; Astro and static consumers use the browser-native
custom element. Both identify the current project and may override the
accessible label, theme, speed, or catalog URL.

## Capabilities and Constraints

- Fleet's private project catalog remains canonical; SaaS Maker consumes only
  its checked-in `catalog/generated/public.json` projection.
- The package contains no credentials, analytics, storage, default backend, or
  Fleet-hosted runtime.
- The public catalog exposes only the documented safe project projection.
- Publishing and product-by-product adoption are separate explicit actions.
- Links remain semantic and usable when revalidation, animation, or JavaScript
  is unavailable.
- Outbound links identify the current project through a referral query
  parameter without mutating canonical catalog data.

## Evidence on Hand

The retained component history defines the product requirements, loading
contract, and accessibility scenarios. The generated package catalog and
public endpoint now consume the same checked-in SaaS Maker projection derived
from the canonical Fleet registry.

## Product Principles

- Render useful content before making a request.
- Fail quietly while retaining the last valid catalog.
- Keep integration optional, themeable, and backend-free.
- Make discovery accessible without turning the footer into a directory.

## Accessibility & Inclusion

Links must remain keyboard reachable and screen-reader named. Moving content
must pause for pointer and keyboard interaction and become static under
`prefers-reduced-motion`; the compact default surface contains no standalone
motion control.
