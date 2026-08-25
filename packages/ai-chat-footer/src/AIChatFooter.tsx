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
      <div className="ai-chat-footer__intro">
        <span className="ai-chat-footer__signal" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false">
            <path d="M10 2.25c.4 4.45 3.3 7.35 7.75 7.75-4.45.4-7.35 3.3-7.75 7.75C9.6 13.3 6.7 10.4 2.25 10 6.7 9.6 9.6 6.7 10 2.25Z" />
          </svg>
        </span>
        <div>
          <h2 className="ai-chat-footer__label">{label}</h2>
          <p className="ai-chat-footer__description">
            Open a pre-filled question in a new tab with the assistant you already use.
          </p>
        </div>
      </div>
      <ul className="ai-chat-footer__icons">
        {providers.map((id) => {
          const config = registry[id];
          const resolved = resolvePrompt(prompt, ctx, id);
          const href = config.buildUrl(resolved);
          const actionLabel = `Ask ${config.name} about ${companyName} (opens in a new tab)`;

          return (
            <li key={id} className="ai-chat-footer__item">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="ai-chat-footer__link"
                aria-label={actionLabel}
                data-ai-provider={id}
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
