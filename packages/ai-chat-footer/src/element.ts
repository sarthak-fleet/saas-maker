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
      d: 'M12 3v18M3 12h18M5.65 5.65l12.7 12.7M18.35 5.65l-12.7 12.7',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.4',
      'stroke-linecap': 'round',
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
      d: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
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
        ul { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; margin: 0; padding: 0; list-style: none; }
        a { display: inline-flex; width: 100%; min-height: 2.75rem; align-items: center; gap: .45rem; padding: .45rem .7rem .45rem .5rem; border: 1px solid var(--ai-footer-border); border-radius: .75rem; background: var(--ai-footer-control); color: inherit; font-size: .75rem; font-weight: 680; text-decoration: none; transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease; }
        a:hover { border-color: color-mix(in srgb, currentColor 28%, transparent); background: color-mix(in srgb, currentColor 8%, transparent); transform: translateY(-1px); }
        a:focus-visible { outline: 2px solid var(--ai-footer-focus); outline-offset: 2px; }
        .mark { --provider-color: currentColor; display: grid; width: 1.75rem; height: 1.75rem; place-items: center; border-radius: .5rem; background: color-mix(in srgb, var(--provider-color) 16%, transparent); color: var(--provider-color); }
        a[data-ai-provider='claude'] .mark { --provider-color: #d97757; }
        a[data-ai-provider='chatgpt'] .mark { --provider-color: #10a37f; }
        a[data-ai-provider='gemini'] .mark { --provider-color: #8e75b2; }
        a[data-ai-provider='perplexity'] .mark { --provider-color: #1fb8cd; }
        a[data-ai-provider='grok'] .mark { --provider-color: #8b8b91; }
        .mark svg { width: 1rem; height: 1rem; }
        @media (max-width: 1000px) { .footer { grid-template-columns: minmax(0, 1fr); gap: 1rem; } ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); justify-content: stretch; } li:last-child:nth-child(odd) { grid-column: 1 / -1; width: calc(50% - .25rem); justify-self: center; } li:last-child:nth-child(odd) a { justify-content: center; } }
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
        link.setAttribute(
          'aria-label',
          `Ask ${PROVIDER_NAMES[provider]} about ${companyName} (opens in a new tab)`
        );

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
