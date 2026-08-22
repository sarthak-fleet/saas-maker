---
title: Feedback API
description: The intentionally small SaaS Maker HTTP API.
---

Base URL: https://api.sassmaker.com

Machine-readable contract: [https://api.sassmaker.com/openapi.json](https://api.sassmaker.com/openapi.json)

Errors are JSON objects of the form `{ "error": { "code", "message", "path" } }`.

| Surface | Purpose | Auth |
| --- | --- | --- |
| GET /health | Liveness | None |
| GET /openapi.json | OpenAPI 3.1 document | None |
| POST /v1/feedback | Submit feedback (JSON or multipart) | X-Project-Key |
| GET /v1/feedback | List feedback with project, type, status, date, and cursor filters | Owner session or agent token |
| GET /v1/feedback/:id | Read one record, including status events | Owner session or agent token |
| PATCH /v1/feedback/:id | Update lifecycle status | Owner session or write-enabled agent token |
| POST /v1/upload | Upload a screenshot for JSON clients | X-Project-Key |
| /v1/projects | Manage project keys | Owner session |
| /v1/projects/:id/agent-tokens | Create, list, and revoke agent tokens | Owner session |
| /v1/auth/session | Resolve inbox session | Owner session |

The publishable project key can only submit. Inbox reads and mutations use the owner's session or a separately issued `smk_` agent token. Agent tokens default to read-only.

All other historical SaaS Maker service families are retired from this API.
