# `@saas-maker/ai-chat-footer`

Backend-free React and browser-native footer widget that lets visitors ask Claude, ChatGPT, Gemini,
Perplexity, or Grok about your product. Each icon opens the visitor's chosen AI
assistant in a new tab with a pre-filled prompt.

- No backend, no API keys, no analytics, no cookies.
- React and browser integrations use the same labelled SVG provider actions.
- Customizable prompt, label, provider set, theme, and styling.

## Install

```bash
pnpm add @saas-maker/ai-chat-footer
```

## Browser-native integration

Astro, static HTML, and other non-React consumers can load the package's
custom-element entrypoint:

```html
<script type="module" src="/vendor/ai-chat-footer/element.js"></script>
<ai-chat-footer
  product-name="Acme"
  product-url="https://acme.com"
></ai-chat-footer>
```

Bundler-based consumers can import `@saas-maker/ai-chat-footer/browser`.
Supported attributes are `product-name`, `product-url`, `label`, `prompt`,
`providers`, and `theme`. The browser entrypoint remains backend-free and uses
the same provider URLs and default prompt contract as the React component.

### Fleet hosted integration

Fleet product pages should load the AI footer once, after their authored
footer:

```html
<script src="https://sassmaker.com/ai-chat-footer.js" data-name="Acme" defer></script>
```

The loader appends one host-neutral utility dock. A product's authored footer
remains untouched above it. Do not add a second local AI footer or wrap the
widget in another full-height footer. The hosted loader removes the legacy
portfolio strip when both old loaders are still present; set
`data-compose="false"` temporarily only while migrating a host that deliberately
keeps its independent strip.

Import the component and its CSS:

```tsx
import { AIChatFooter } from '@saas-maker/ai-chat-footer';
import '@saas-maker/ai-chat-footer/dist/index.css';

function Footer() {
  return (
    <AIChatFooter
      companyName="Acme"
      companyUrl="https://acme.com"
    />
  );
}
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `companyName` | `string` | yes | — | Product or company name |
| `companyUrl` | `string` | yes | — | Product or company URL |
| `prompt` | `string \| (ctx, provider) => string` | no | see below | Prompt template or builder |
| `providers` | `AIChatProvider[]` | no | all five | Providers to show, in order |
| `label` | `ReactNode` | no | `Explore {companyName} with AI` | Heading above the provider actions |
| `theme` | `"light" \| "dark" \| "auto"` | no | `"auto"` | Color scheme |
| `className` | `string` | no | — | Extra class on the root element |

## Default prompt

```
What does {companyName} ({companyUrl}) do, and who is it best for? Keep it concise.
```

## Customization

### Override the prompt

```tsx
<AIChatFooter
  companyName="Acme"
  companyUrl="https://acme.com"
  prompt="Compare Acme to alternatives for small businesses. Be honest about pros and cons."
/>
```

### Per-provider prompts

```tsx
<AIChatFooter
  companyName="Acme"
  companyUrl="https://acme.com"
  prompt={({ companyName, companyUrl }, provider) =>
    provider === 'perplexity'
      ? `Research ${companyName} (${companyUrl}) and cite sources.`
      : `What does ${companyName} do?`
  }
/>
```

### Show only some providers

```tsx
<AIChatFooter
  companyName="Acme"
  companyUrl="https://acme.com"
  providers={['claude', 'chatgpt']}
/>
```

### Theming

Set `theme="light"` or `theme="dark"` to force a scheme, or use `theme="auto"`
to follow `prefers-color-scheme`. Override CSS custom properties for full
control:

```css
.ai-chat-footer {
  --ai-chat-footer-icon-size: 2rem;
  --ai-chat-footer-icon-color: #555;
  --ai-chat-footer-icon-hover: #000;
}
```

## Supported providers

| Provider | Deep link |
|----------|-----------|
| Claude | `https://claude.ai/new?q={prompt}` |
| ChatGPT | `https://chatgpt.com/?q={prompt}` |
| Gemini | `https://gemini.google.com/app?is_sa=1&is_sa_p={prompt}` |
| Perplexity | `https://www.perplexity.ai/?q={prompt}` |
| Grok | `https://grok.com/?q={prompt}` |

## License

MIT
