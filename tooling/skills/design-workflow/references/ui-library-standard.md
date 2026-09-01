# Fleet web UI sourcing standard

## Default

Use an upstream-first strategy. For every new or materially redesigned web
surface, search for and adapt a proven component or block before authoring a
replacement.

Tailwind Plus is Fleet's default visual source for new or deficient web
surfaces when the owner's personal license is available. It is selected for
design quality, not cross-framework coverage: its professionally designed
blocks, templates, and Catalyst application kit provide the strongest
consistent starting point for one-shot web UI work.

- Product and license: https://tailwindcss.com/plus
- UI blocks: https://tailwindcss.com/plus/ui-blocks
- Catalyst application kit: https://tailwindcss.com/plus/ui-kit
- Interactive HTML elements: https://tailwindcss.com/plus/ui-blocks/documentation/elements

Preline remains the default no-license fallback because its free catalog has
substantially broader raw coverage. It is not the quality-first default when
Tailwind Plus is lawfully available:

- Components: https://preline.co/docs/index.html
- Blocks: https://preline.co/blocks/
- License: https://preline.co/license.html

**Current access decision (2026-09-01):** the owner confirmed there is no paid
Tailwind Plus access. Until that changes, treat proprietary Tailwind Plus
source as unavailable. Start deficient web surfaces from Preline's free catalog
or another maintained free upstream that materially fits the product better,
with the exact source and license recorded in the design receipt.

These libraries provide interface structure and behavior, not Fleet identity.
Adapt the selected source with the product's real content, semantic tokens,
typography, spacing, imagery, and distinctive product proof. The result must
not look like an untouched component gallery.

## Selection order

1. Preserve a healthy project-native component or pattern when it already
   solves the job well.
2. For a new or deficient landing page, marketing site, or general web surface,
   search Tailwind Plus blocks and templates first when licensed access is
   available through the owner's authenticated personal account.
3. For a new React application system, use Tailwind Plus Catalyst as the visual
   base. Use an existing Radix or shadcn primitive when the product already
   depends on it or it better owns the required behavior.
4. When licensed Tailwind Plus source is unavailable, use Preline as the free
   fallback rather than delaying the work or inventing a replacement.
5. Use another maintained upstream source only when it materially fits the
   product better; record the reason and license.
6. Create a replacement interface pattern only when the owner explicitly asks
   for one. Record that authorization and the missing upstream capability.

Composing, styling, and adapting upstream parts to the product is expected.
Reinventing standard navigation, forms, dialogs, disclosure, tables, cards,
footers, pricing, FAQs, or other common UI is not.

## Runtime and dependency rules

- Prefer copied/adapted static markup when no JavaScript behavior is needed.
- For licensed HTML blocks, use Tailwind Plus Elements only when the selected
  interaction requires it. For React or Vue, use the behavior primitive shipped
  with or specified by the selected source.
- When using the Preline fallback, install `preline` only for a selected
  interactive component and import only the needed plugin or non-auto entry
  point. Do not install its optional integration stack by default.
- Never store account credentials, license keys, downloaded archives, or
  proprietary source in shared Fleet tooling. Licensed source belongs only in
  the lawful end product. Purchasing a license remains a separate spend action.
- Do not migrate a healthy Radix, shadcn, or project-native system merely for
  conformity. Apply this standard when a surface is new or being materially
  changed.
- Apple-native interfaces use Apple frameworks and design resources as their
  own upstream system and are outside this web standard.

## Priority-scaled delivery depth

Use the canonical `identity.priority` in Site Health to decide how much bespoke
craft and validation time a surface receives. Priority changes depth, not
truthfulness or basic usability.

- **P1 / flagship:** benchmark against Fleet's strongest surfaces. Require a
  product-specific composition and proof artifact, complete interaction states,
  all three responsive viewports, the strongest project checks, and a visual
  target of at least 90/100.
- **P2 / active:** require polished production quality and a recognisable
  product identity, but prefer selective adaptation over a new design system.
  Target at least 85/100 visual quality with the standard responsive and project
  checks.
- **P3 / secondary:** use a proven upstream composition with real product
  content and one product-specific signature. Target at least 80/100 and run the
  smallest checks that cover the changed surface.
- **P4 / parked or exploratory:** use the shared template or one upstream block,
  keep the implementation intentionally small, and target at least 75/100. Do
  not spend flagship-level time inventing bespoke art direction for a held
  experiment.

Every priority must still pass the 85/100 product-purpose gate, accurately state
lifecycle and commercial availability, preserve accessible navigation and
focus, avoid responsive overflow, and keep the primary action functional.

## Receipt and quality gate

Record the exact component or block URLs in `direction.library.sources`, along
with the runtime posture. If a custom replacement pattern was owner-requested,
record the authorization and reason.

Upstream sourcing does not waive Fleet's product-purpose, accessibility,
responsive-browser, performance, or visual-review gates. A broad library helps
avoid needless invention; it does not make the page product-specific or good by
itself.

Run performance evidence against a production build or production-equivalent
preview. Framework development clients and hot-reload modules are not valid
release-performance evidence.
