# AI Chat Footer

## Purpose

Give a product visitor one clear, backend-free way to open a useful question in
an AI assistant they already use.

## Users and job

The component serves visitors who want a concise explanation of a product
without first learning a new interface. Product teams embed it as a small
extension below their own authored footer.

## Product contract

- Keep the product name and the AI action explicit.
- Show provider names alongside recognizable marks; never rely on icon-only or
  letter-only controls.
- Open a pre-filled prompt in the selected provider without API keys, storage,
  analytics, authentication, or a SaaS Maker backend.
- Preserve the host product's footer, color, typography, and runtime boundary.
- Stay focused on the AI handoff. Portfolio discovery and studio navigation
  remain separate components owned by the host product.

## Non-goals

The package is not a chatbot, prompt editor, analytics surface, model router,
or Fleet control plane. It does not judge providers or make claims about their
availability.
