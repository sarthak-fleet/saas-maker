import { PROVIDER_LOGOS } from './providerLogos';
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

const SVG_NS = 'http://www.w3.org/2000/svg';

function createProviderLogo(provider: AIChatProvider): HTMLImageElement {
  const image = document.createElement('img');
  image.src = PROVIDER_LOGOS[provider];
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.decoding = 'async';
  return image;
}

function createSparkleIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    'M8 1.5c.35 3.65 2.85 6.15 6.5 6.5-3.65.35-6.15 2.85-6.5 6.5C7.65 10.85 5.15 8.35 1.5 8 5.15 7.65 7.65 5.15 8 1.5Z'
  );
  svg.append(path);
  return svg;
}

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
      const label = this.getAttribute('label') || `Explore ${companyName} with AI`;
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
          --ai-footer-muted: color-mix(in srgb, currentColor 72%, transparent);
          --ai-footer-border: color-mix(in srgb, currentColor 18%, transparent);
          --ai-footer-surface: transparent;
          --ai-footer-control: color-mix(in srgb, currentColor 4%, transparent);
          --ai-footer-focus: #2563eb;
          display: block;
          color: var(--ai-footer-text);
          background: var(--ai-footer-surface);
          font: inherit;
        }
        :host([theme='light']) { color-scheme: light; }
        :host([theme='dark']) { color-scheme: dark; }
        * { box-sizing: border-box; }
        .footer { display: grid; grid-template-columns: minmax(13rem, .72fr) minmax(0, 1.28fr); align-items: center; gap: clamp(1.25rem, 3vw, 3rem); padding: 1.25rem var(--ai-footer-edge, 1.25rem); border-block-start: 1px solid var(--ai-footer-border); }
        :host([integrated]) .footer { border-block-start: 0; }
        p { margin: 0; }
        .intro { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); align-items: start; gap: .8rem; }
        .signal { display: grid; width: 2.5rem; height: 2.5rem; place-items: center; border: 1px solid var(--ai-footer-border); border-radius: .75rem; background: var(--ai-footer-control); }
        .signal svg { width: 1.15rem; height: 1.15rem; fill: currentColor; }
        .label { margin: 0; font-size: clamp(1rem, 1.4vw, 1.15rem); font-weight: 720; letter-spacing: -.025em; line-height: 1.2; }
        .description { max-width: 36rem; margin-top: .3rem; color: var(--ai-footer-muted); font-size: .78rem; line-height: 1.45; }
        ul { display: flex; flex-wrap: nowrap; justify-content: flex-end; gap: .25rem; margin: 0; padding: 0; list-style: none; }
        a { display: grid; width: 2.75rem; height: 2.75rem; min-height: 2.75rem; place-items: center; padding: .375rem; border: 1px solid transparent; border-radius: .75rem; background: transparent; color: inherit; text-decoration: none; transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease; }
        a:hover { border-color: var(--ai-footer-border); background: var(--ai-footer-control); transform: translateY(-1px); }
        a:focus-visible { outline: 2px solid var(--ai-footer-focus); outline-offset: 2px; }
        a img { display: block; width: 2rem; height: 2rem; border-radius: .625rem; object-fit: cover; }
        @media (max-width: 1000px) { .footer { grid-template-columns: minmax(0, 1fr); gap: 1rem; } ul { justify-content: flex-start; } }
        @media (prefers-reduced-motion: reduce) { a { transition: background-color 150ms ease, border-color 150ms ease; } a:hover { transform: none; } }
      `;

      const region = document.createElement('aside');
      region.className = 'footer';
      region.setAttribute('aria-label', 'Ask AI about this product');
      if (theme) region.dataset.theme = theme;

      const intro = document.createElement('div');
      intro.className = 'intro';
      const signal = document.createElement('span');
      signal.className = 'signal';
      signal.setAttribute('aria-hidden', 'true');
      signal.append(createSparkleIcon());
      const copy = document.createElement('div');

      const heading = document.createElement('h2');
      heading.className = 'label';
      heading.textContent = label;

      const description = document.createElement('p');
      description.className = 'description';
      description.textContent =
        'Open a pre-filled question in a new tab with the assistant you already use.';
      copy.append(heading, description);
      intro.append(signal, copy);
      region.append(intro);

      const list = document.createElement('ul');
      for (const provider of providers) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = getProviderUrl(provider, prompt);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.dataset.aiProvider = provider;
        link.title = PROVIDER_NAMES[provider];
        link.setAttribute(
          'aria-label',
          `Ask ${PROVIDER_NAMES[provider]} about ${companyName} (opens in a new tab)`
        );

        link.append(createProviderLogo(provider));
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
