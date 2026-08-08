# `@saas-maker/ai-chat-footer`

Backend-free React footer widget that lets visitors ask Claude, ChatGPT, Gemini,
Perplexity, or Grok about your product. Each icon opens the visitor's chosen AI
assistant in a new tab with a pre-filled prompt.

- No backend, no API keys, no analytics, no cookies.
- Inline SVG icons — no icon fonts or image assets.
- Customizable prompt, label, provider set, theme, and styling.

## Install

```bash
pnpm add @saas-maker/ai-chat-footer
```

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
| `label` | `ReactNode` | no | `Ask AI about {companyName}` | Heading above the icons |
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
