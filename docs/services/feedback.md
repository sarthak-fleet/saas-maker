---
title: Feedback service
description: Hosted capture, review, and agent-readable lifecycle.
---

Feedback is a bug, feature request, or general comment. A hosted submission
needs a title, description, valid type, and publishable project key. Email,
name, screenshots, page identity, and Pinpoint element context are optional.

The private inbox at app.sassmaker.com lists newest items first, filters by
project, type, and status, and updates lifecycle. There is no public board,
voting, or Fleet Console workflow.

Retained statuses support existing data: new, acknowledged, investigating,
planned, in_progress, resolved, dismissed, and on_roadmap.

## Privacy and retention

Submissions are stored in SaaS Maker's Feedback D1 database. Screenshot files
are stored in a Feedback-owned R2 bucket; D1 keeps only the object URL.
Page URL, page title, and Pinpoint selectors are stored as customer evidence
and are never overwritten by later enrichment.

Owner sessions and agent tokens can read the original title, description, page
context, and submitter fields. Project keys cannot. SaaS Maker does not delete
historical rows as part of ordinary review. Integrating products should
disclose this collection in their own privacy policy.

SaaS Maker does not turn feedback into tasks or marketing work. The owning
product repository decides what to do after review.
