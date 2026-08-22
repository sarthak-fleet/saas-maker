---
title: Feedback widget
description: Configure the React feedback widget.
---

FeedbackWidget accepts exactly one destination: hosted `projectKey`,
`ingestionUrl`, or `onSubmit`.

| Prop | Purpose |
| --- | --- |
| projectKey | Public project key for the hosted SaaS Maker service |
| apiBaseUrl | Optional API override; defaults to https://api.sassmaker.com |
| ingestionUrl | Caller-owned multipart endpoint |
| onSubmit | Product-owned submission callback |
| userEmail | Pre-fill and lock the submitter email |
| userName | Pre-fill the submitter name |
| types | Allow bug, feature, feedback, or a subset |
| position | bottom-right or bottom-left |
| theme | light, dark, or auto |
| accentColor | Brand colour used by the widget |
| triggerText | Trigger-button copy |
| enablePointing | Let the user attach a page element; enabled by default |

The stylesheet is scoped under the widget root and does not intentionally style
the host application.

~~~tsx
<FeedbackWidget
  projectKey="pk_example"
  types={['bug', 'feature']}
  position="bottom-left"
  accentColor="#7c3aed"
  triggerText="Send feedback"
/>
~~~

Hosted mode sends one multipart POST to `/v1/feedback`. Screenshots accept
JPEG, PNG, GIF, and WebP files up to 5 MB.
