import * as icons from './icons';
import { createProviderRegistry, DEFAULT_PROMPT_TEMPLATE, DEFAULT_PROVIDERS } from './providers';
import type { AIChatFooterProps, AIChatProvider, PromptContext } from './types';
import './index.css';

const registry = createProviderRegistry({
  claude: icons.ClaudeIcon,
  chatgpt: icons.ChatGPTIcon,
  gemini: icons.GeminiIcon,
  perplexity: icons.PerplexityIcon,
  grok: icons.GrokIcon,
});

function interpolate(template: string, ctx: PromptContext): string {
  return template
    .replace(/\{companyName\}/g, ctx.companyName)
    .replace(/\{companyUrl\}/g, ctx.companyUrl);
}

function resolvePrompt(
  prompt: AIChatFooterProps['prompt'],
  ctx: PromptContext,
  provider: AIChatProvider
): string {
  if (typeof prompt === 'function') return prompt(ctx, provider);
  const template = prompt && prompt.length > 0 ? prompt : DEFAULT_PROMPT_TEMPLATE;
  return interpolate(template, ctx);
}

export function AIChatFooter({
  companyName,
  companyUrl,
  prompt,
  providers = DEFAULT_PROVIDERS,
  label = `Explore ${companyName} with AI`,
  theme = 'auto',
  className = '',
}: AIChatFooterProps) {
  const themeAttr = theme === 'auto' ? undefined : theme;
  const ctx: PromptContext = { companyName, companyUrl };

  return (
    <div
      className={`ai-chat-footer ${className}`}
      data-theme={themeAttr}
      role="region"
      aria-label="Ask AI about this product"
    >
      <div className="ai-chat-footer__eyebrow" aria-hidden="true">
        <svg viewBox="0 0 16 16" focusable="false">
          <path d="M8 1.5c.35 3.65 2.85 6.15 6.5 6.5-3.65.35-6.15 2.85-6.5 6.5C7.65 10.85 5.15 8.35 1.5 8 5.15 7.65 7.65 5.15 8 1.5Z" />
        </svg>
        <span>AI shortcut</span>
      </div>
      <h2 className="ai-chat-footer__label">{label}</h2>
      <p className="ai-chat-footer__description">
        Open a focused question in the assistant you already use.
      </p>
      <ul className="ai-chat-footer__icons">
        {providers.map((id) => {
          const config = registry[id];
          const resolved = resolvePrompt(prompt, ctx, id);
          const href = config.buildUrl(resolved);
          const actionLabel = `Ask ${config.name} about ${companyName}`;

          return (
            <li key={id} className="ai-chat-footer__item">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="ai-chat-footer__link"
                aria-label={actionLabel}
              >
                <span className="ai-chat-footer__mark" aria-hidden="true">
                  <config.Icon className="ai-chat-footer__icon" />
                </span>
                <span>{config.name}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
