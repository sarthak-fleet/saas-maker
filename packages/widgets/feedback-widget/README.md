# @saas-maker/feedback

A React feedback widget with optional screenshots and Pinpoint page-element
context. Use SaaS Maker's hosted submission service or connect a destination
your application already owns.

## Install

```bash
pnpm add @saas-maker/feedback
```

## Quick start: callback

```tsx
import { FeedbackWidget } from '@saas-maker/feedback'
import '@saas-maker/feedback/dist/index.css'

export function AppFeedback() {
  return (
    <FeedbackWidget
      onSubmit={async (feedback) => {
        await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...feedback,
            screenshot: undefined,
          }),
        })

        // feedback.screenshot is the original File. Upload it separately if needed.
      }}
    />
  )
}
```

`onSubmit` may send an email, create an issue, call an authenticated API, or
write to any system your product already uses.

## Quick start: hosted service

Create a project in the private feedback inbox, then use its public submission
key in the browser:

```tsx
import { FeedbackWidget } from '@saas-maker/feedback'
import '@saas-maker/feedback/dist/index.css'

export function AppFeedback() {
  return <FeedbackWidget projectKey="feedback_public_example" />
}
```

The public key can only identify the destination project. It is not a secret
and must not grant inbox access. The widget submits to `api.sassmaker.com` and
uploads an optional screenshot before creating the feedback record.

## Quick start: ingestion URL

Use `ingestionUrl` when your caller-owned endpoint accepts the package's stable
multipart contract:

```tsx
import { FeedbackWidget } from '@saas-maker/feedback'
import '@saas-maker/feedback/dist/index.css'

export function AppFeedback() {
  return <FeedbackWidget ingestionUrl="/api/feedback" />
}
```

The destination may be a relative path or an absolute HTTP(S) URL. Cross-origin
destinations must allow the request through CORS. The package sends no cookies,
authorization, project key, or other credentials. Use `onSubmit` instead when
the destination requires authentication or a different payload.

Configure exactly one of `projectKey`, `onSubmit`, and `ingestionUrl`.

### Endpoint contract

URL mode sends one `POST` with a `FormData` body:

| Field | Value |
|---|---|
| `feedback` | JSON string containing the submission without `screenshot` |
| `screenshot` | Original image file when supplied; otherwise omitted |

The widget displays success only after a 2xx response. A network failure or
non-2xx response keeps the form data available and shows an error. Requests are
never retried automatically.

## Payload

```ts
interface FeedbackSubmission {
  type: 'bug' | 'feature' | 'feedback'
  title: string
  description: string
  email?: string
  name?: string
  anchor?: {
    selector: string
    tag: string | null
    text: string
    source: string | null
    url: string
  }
  screenshot?: File
  page: {
    url: string
    title: string
  }
}
```

The success state appears only after the selected destination succeeds.
Callback errors and URL ingestion failures are shown in the form.

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `onSubmit` | `(feedback) => void \| Promise<void>` | XOR | Product-owned submission callback |
| `ingestionUrl` | `string` | XOR | Caller-owned HTTP(S) multipart endpoint |
| `projectKey` | `string` | XOR | Public key for the hosted SaaS Maker feedback service |
| `apiBaseUrl` | `string` | api.sassmaker.com | Hosted API override for local/self-hosted use |
| `userEmail` | `string` | — | Pre-filled email |
| `userName` | `string` | — | Pre-filled name |
| `requireEmail` | `boolean` | `false` | Require an email before submission |
| `types` | `FeedbackType[]` | bug, feature, feedback | Allowed types |
| `position` | bottom-right or bottom-left | bottom-right | Trigger position |
| `theme` | light, dark, or auto | auto | Color theme |
| `accentColor` | `string` | `#1464ff` | Accent color |
| `triggerText` | `string` | Feedback | Trigger label |
| `enablePointing` | `boolean` | `true` | Enable Pinpoint |

## Pinpoint

Pinpoint lets the user click a page element. The submission receives a selector,
visible text, page path, and source hint when React development metadata or a
`data-source` attribute is available. Nothing is submitted until the user
explicitly sends the form.

## Screenshots

JPEG, PNG, GIF, and WebP files up to 5 MB can be attached. Callback mode receives
the original `File`; URL mode uploads it in the `screenshot` multipart field.
The package does not retain it.

## Privacy

Your product controls the endpoint, authentication, destination, and retention
policy. Disclose collected feedback, identity fields, screenshots, and
page-element context in your own privacy policy where appropriate. Never place
a secret in client-side widget configuration.

## Compatibility

- React 18 and React 19
- Modern browsers with `File`, `URL.createObjectURL`, and DOM APIs
- Client-rendered components

## License

MIT
