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
  label = `Ask AI about ${companyName}`,
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
      <div className="ai-chat-footer__label">{label}</div>
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
                <config.Icon className="ai-chat-footer__icon" />
                <span className="ai-chat-footer__sr-only">{actionLabel}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
