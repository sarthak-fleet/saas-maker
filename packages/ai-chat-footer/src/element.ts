import { DEFAULT_PROMPT_TEMPLATE, DEFAULT_PROVIDERS, getProviderUrl } from './providers';
import type { AIChatProvider } from './types';

export const AI_CHAT_FOOTER_TAG = 'ai-chat-footer';

const PROVIDER_NAMES: Record<AIChatProvider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  grok: 'Grok',
};

const PROVIDER_MARKS: Record<AIChatProvider, string> = {
  claude: 'C',
  chatgpt: 'O',
  gemini: 'G',
  perplexity: 'P',
  grok: 'X',
};

function interpolate(template: string, companyName: string, companyUrl: string): string {
  return template.replace(/\{companyName\}/g, companyName).replace(/\{companyUrl\}/g, companyUrl);
}

export function normalizeProviderIds(value: string | null): AIChatProvider[] {
  if (!value) return DEFAULT_PROVIDERS;
  const allowed = new Set<AIChatProvider>(DEFAULT_PROVIDERS);
  const providers = value
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is AIChatProvider => allowed.has(provider as AIChatProvider));
  return providers.length > 0 ? [...new Set(providers)] : DEFAULT_PROVIDERS;
}

export function registerAIChatFooter(): void {
  if (typeof window === 'undefined' || customElements.get(AI_CHAT_FOOTER_TAG)) return;

  class AIChatFooterElement extends HTMLElement {
    static observedAttributes = [
      'company-name',
      'company-url',
      'product-name',
      'product-url',
      'label',
      'prompt',
      'providers',
      'theme',
    ];

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    render() {
      const companyName =
        this.getAttribute('product-name') || this.getAttribute('company-name') || 'this product';
      const companyUrl =
        this.getAttribute('product-url') ||
        this.getAttribute('company-url') ||
        window.location.origin;
      const label = this.getAttribute('label') || `Chat with us through AI about ${companyName}`;
      const promptTemplate = this.getAttribute('prompt') || DEFAULT_PROMPT_TEMPLATE;
      const prompt = interpolate(promptTemplate, companyName, companyUrl);
      const providers = normalizeProviderIds(this.getAttribute('providers'));
      const theme = this.getAttribute('theme');
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      root.replaceChildren();

      const style = document.createElement('style');
      style.textContent = `
        :host {
          --ai-footer-text: inherit;
          --ai-footer-muted: color-mix(in srgb, currentColor 62%, transparent);
          --ai-footer-border: color-mix(in srgb, currentColor 18%, transparent);
          --ai-footer-surface: transparent;
          --ai-footer-focus: #2563eb;
          display: block;
          color: var(--ai-footer-text);
          background: var(--ai-footer-surface);
          font: inherit;
        }
        :host([theme='light']) { color-scheme: light; }
        :host([theme='dark']) { color-scheme: dark; }
        .footer { padding: 1.5rem var(--ai-footer-edge, 1rem); border-block-start: 1px solid var(--ai-footer-border); }
        :host([integrated]) .footer { height: 100%; padding: 1rem var(--ai-footer-edge, 1rem); border-block-start: 0; }
        .label { margin: 0; color: var(--ai-footer-muted); font-size: .75rem; line-height: 1.4; }
        ul { display: flex; flex-wrap: wrap; gap: .5rem; margin: .75rem 0 0; padding: 0; list-style: none; }
        a { display: inline-flex; min-height: 2.75rem; align-items: center; gap: .5rem; padding: .375rem .75rem .375rem .375rem; border: 1px solid var(--ai-footer-border); border-radius: 999px; color: inherit; font-size: .75rem; font-weight: 650; text-decoration: none; }
        a:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
        a:focus-visible { outline: 2px solid var(--ai-footer-focus); outline-offset: 2px; }
        .mark { display: grid; width: 1.8rem; height: 1.8rem; place-items: center; border-radius: 50%; background: currentColor; font-size: .64rem; }
        .mark > span { color: Canvas; }
      `;

      const region = document.createElement('aside');
      region.className = 'footer';
      region.setAttribute('aria-label', 'Ask AI about this product');
      if (theme) region.dataset.theme = theme;

      const heading = document.createElement('p');
      heading.className = 'label';
      heading.textContent = label;
      region.append(heading);

      const list = document.createElement('ul');
      for (const provider of providers) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = getProviderUrl(provider, prompt);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.dataset.aiProvider = provider;
        link.setAttribute('aria-label', `Ask ${PROVIDER_NAMES[provider]} about ${companyName}`);

        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.setAttribute('aria-hidden', 'true');
        const markText = document.createElement('span');
        markText.textContent = PROVIDER_MARKS[provider];
        mark.append(markText);
        link.append(mark, document.createTextNode(PROVIDER_NAMES[provider]));
        item.append(link);
        list.append(item);
      }
      region.append(list);
      root.append(style, region);
    }
  }

  customElements.define(AI_CHAT_FOOTER_TAG, AIChatFooterElement);
}

registerAIChatFooter();
