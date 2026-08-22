---
title: Project keys
description: How feedback projects, browser-safe keys, and agent tokens work.
---

A project key routes feedback to one product. Create and manage keys in the
private inbox at app.sassmaker.com.

Send the key as the `X-Project-Key` header or as the FeedbackWidget
`projectKey`. The key is an identifier and submission credential, not an
administrative session. Inbox reads and mutations require the owner's
authenticated session or a separately issued agent token.

Agent tokens are Bearer credentials prefixed `smk_`. They are scoped to one
project, default to read-only, and only mutate status when created with write
permission. The plaintext token is shown once.

Keep one key per product surface so feedback can be filtered and reviewed
without inventing a second fleet registry.
