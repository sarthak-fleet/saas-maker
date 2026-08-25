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

function createProviderIcon(provider: AIChatProvider): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const add = (tag: 'circle' | 'path', attributes: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  };

  if (provider === 'claude') {
    add('path', {
      d: 'M12 2l2.5 7h7l-5.7 4.2 2.2 7-6-4.5-6 4.5 2.2-7L2.5 9h7L12 2z',
      fill: 'currentColor',
    });
  }
  if (provider === 'chatgpt') {
    add('path', {
      d: 'M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    });
    add('circle', {
      cx: '12',
      cy: '12',
      r: '3',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    });
  }
  if (provider === 'gemini') {
    add('path', {
      d: 'M12 2l3 7.5h7.5l-6 4.5 2.25 7.5-6.75-5-6.75 5 2.25-7.5-6-4.5H9L12 2z',
      fill: 'currentColor',
    });
  }
  if (provider === 'perplexity') {
    add('circle', {
      cx: '12',
      cy: '12',
      r: '9',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    });
    add('circle', { cx: '12', cy: '12', r: '4', fill: 'currentColor' });
  }
  if (provider === 'grok') {
    add('path', {
      d: 'M12 2L2 22h6l4-8 4 8h6L12 2zm0 6l3 6H9l3-6z',
      fill: 'currentColor',
    });
  }

  return svg;
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
        .footer { display: grid; align-content: center; min-height: 11rem; padding: 1.5rem var(--ai-footer-edge, 1rem); border-block-start: 1px solid var(--ai-footer-border); }
        :host([integrated]) .footer { height: 100%; padding: 1.25rem var(--ai-footer-edge, 1.25rem); border-block-start: 0; }
        p { margin: 0; }
        .eyebrow { display: flex; align-items: center; gap: .4rem; color: var(--ai-footer-muted); font-size: .64rem; font-weight: 750; letter-spacing: .1em; line-height: 1; text-transform: uppercase; }
        .eyebrow svg { width: .9rem; height: .9rem; fill: none; stroke: currentColor; stroke-width: 1.6; }
        .label { margin: .55rem 0 0; font-size: clamp(1rem, 1.4vw, 1.2rem); font-weight: 720; letter-spacing: -.025em; line-height: 1.2; }
        .description { max-width: 36rem; margin-top: .35rem; color: var(--ai-footer-muted); font-size: .74rem; line-height: 1.45; }
        ul { display: grid; grid-template-columns: repeat(3, max-content); gap: .45rem; margin: 1rem 0 0; padding: 0; list-style: none; }
        a { display: inline-flex; width: 100%; min-height: 2.75rem; align-items: center; gap: .5rem; padding: .35rem .72rem .35rem .35rem; border: 1px solid var(--ai-footer-border); border-radius: .65rem; color: inherit; font-size: .72rem; font-weight: 680; text-decoration: none; transition: background-color 140ms ease, border-color 140ms ease; }
        a:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
        a:focus-visible { outline: 2px solid var(--ai-footer-focus); outline-offset: 2px; }
        .mark { display: grid; width: 1.95rem; height: 1.95rem; place-items: center; border-radius: .45rem; background: color-mix(in srgb, currentColor 8%, transparent); }
        .mark svg { width: 1.05rem; height: 1.05rem; }
        @media (max-width: 1000px) { ul { grid-template-columns: repeat(2, minmax(0, 1fr)); } li:last-child:nth-child(odd) { grid-column: 1 / -1; width: calc(50% - .225rem); justify-self: center; } }
        @media (max-width: 480px) { .footer { min-height: 0; } }
      `;

      const region = document.createElement('aside');
      region.className = 'footer';
      region.setAttribute('aria-label', 'Ask AI about this product');
      if (theme) region.dataset.theme = theme;

      const eyebrow = document.createElement('p');
      eyebrow.className = 'eyebrow';
      eyebrow.append(createSparkleIcon(), document.createTextNode('AI shortcut'));
      region.append(eyebrow);

      const heading = document.createElement('h2');
      heading.className = 'label';
      heading.textContent = label;
      region.append(heading);

      const description = document.createElement('p');
      description.className = 'description';
      description.textContent = 'Open a focused question in the assistant you already use.';
      region.append(description);

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
        mark.append(createProviderIcon(provider));
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
