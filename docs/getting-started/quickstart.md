---
title: Quickstart
description: Add the SaaS Maker feedback widget to a React application.
---

Create a project key in the private SaaS Maker inbox, then install the package:

~~~bash
pnpm add @saas-maker/feedback
~~~

Import the component and its scoped stylesheet:

~~~tsx
import { FeedbackWidget } from '@saas-maker/feedback';
import '@saas-maker/feedback/dist/index.css';

export function ProductFeedback() {
  return (
    <FeedbackWidget
      projectKey="pk_your_project_key"
      userEmail="signed-in-user@example.com"
      theme="auto"
    />
  );
}
~~~

The project key identifies where feedback is stored. It is intentionally used
in browser requests and is not a privileged server secret.

Continue with [widget options](../widgets/feedback.md) or the
[feedback API](../api/overview.md).
