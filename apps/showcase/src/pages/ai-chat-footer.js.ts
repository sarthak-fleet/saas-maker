import chatgptLogo from '../../../../packages/ai-chat-footer/src/assets/provider-logos/chatgpt.jpg?inline';
import claudeLogo from '../../../../packages/ai-chat-footer/src/assets/provider-logos/claude.jpg?inline';
import geminiLogo from '../../../../packages/ai-chat-footer/src/assets/provider-logos/gemini.jpg?inline';
import grokLogo from '../../../../packages/ai-chat-footer/src/assets/provider-logos/grok.jpg?inline';
import perplexityLogo from '../../../../packages/ai-chat-footer/src/assets/provider-logos/perplexity.jpg?inline';

const providerLogos = {
  claude: claudeLogo,
  chatgpt: chatgptLogo,
  gemini: geminiLogo,
  perplexity: perplexityLogo,
  grok: grokLogo,
};

const source = `(() => {
  'use strict';

  const PROVIDER_LOGOS = ${JSON.stringify(providerLogos)};
  const PROVIDERS = [
    ['claude', 'Claude', (prompt) => 'https://claude.ai/new?q=' + encodeURIComponent(prompt)],
    ['chatgpt', 'ChatGPT', (prompt) => 'https://chatgpt.com/?q=' + encodeURIComponent(prompt)],
    ['gemini', 'Gemini', (prompt) => 'https://gemini.google.com/app?is_sa=1&is_sa_p=' + encodeURIComponent(prompt)],
    ['perplexity', 'Perplexity', (prompt) => 'https://www.perplexity.ai/?q=' + encodeURIComponent(prompt)],
    ['grok', 'Grok', (prompt) => 'https://grok.com/?q=' + encodeURIComponent(prompt)],
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const createProviderLogo = (provider) => {
    const image = document.createElement('img');
    image.src = PROVIDER_LOGOS[provider];
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.decoding = 'async';
    return image;
  };

  const interpolate = (template, name, url) => template
    .replaceAll('{companyName}', name)
    .replaceAll('{companyUrl}', url);

  class AIChatFooter extends HTMLElement {
    connectedCallback() { this.render(); }

    render() {
      const name = this.getAttribute('product-name') || 'this product';
      const url = this.getAttribute('product-url') || window.location.origin;
      const label = this.getAttribute('label') || 'Explore ' + name + ' with AI';
      const prompt = interpolate(
        this.getAttribute('prompt') || 'What does {companyName} ({companyUrl}) do, and who is it best for? Keep it concise.',
        name,
        url,
      );
      const allowed = new Set((this.getAttribute('providers') || PROVIDERS.map(([id]) => id).join(','))
        .split(',').map((value) => value.trim().toLowerCase()));
      const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
      root.replaceChildren();

      const style = document.createElement('style');
      style.textContent = \`
        :host { --ai-footer-muted: color-mix(in srgb, currentColor 62%, transparent); --ai-footer-border: color-mix(in srgb, currentColor 18%, transparent); --ai-footer-control: color-mix(in srgb, currentColor 4%, transparent); --ai-footer-focus: #2563eb; display: block; color: inherit; background: transparent; font: inherit; }
        :host([theme='light']) { color-scheme: light; }
        :host([theme='dark']) { color-scheme: dark; }
        * { box-sizing: border-box; }
        aside { display: grid; grid-template-columns: minmax(13rem, .72fr) minmax(0, 1.28fr); align-items: center; gap: clamp(1.25rem, 3vw, 3rem); padding: 1.25rem var(--ai-footer-edge, 1.25rem); border-block-start: 1px solid var(--ai-footer-border); }
        :host([integrated]) aside { border-block-start: 0; }
        p { margin: 0; }
        .intro { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); align-items: start; gap: .8rem; }
        .signal { display: grid; width: 2.5rem; height: 2.5rem; place-items: center; border: 1px solid var(--ai-footer-border); border-radius: .75rem; background: var(--ai-footer-control); }
        .signal svg { width: 1.15rem; height: 1.15rem; fill: currentColor; }
        .title { margin: 0; font-size: clamp(1rem, 1.4vw, 1.15rem); font-weight: 720; letter-spacing: -.025em; line-height: 1.2; }
        .description { max-width: 36rem; margin-top: .3rem; color: var(--ai-footer-muted); font-size: .78rem; line-height: 1.45; }
        ul { display: flex; flex-wrap: nowrap; justify-content: flex-end; gap: .25rem; margin: 0; padding: 0; list-style: none; }
        a { display: grid; width: 2.75rem; height: 2.75rem; min-height: 2.75rem; place-items: center; padding: .375rem; border: 1px solid transparent; border-radius: .75rem; background: transparent; color: inherit; text-decoration: none; transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease; }
        a:hover { border-color: var(--ai-footer-border); background: var(--ai-footer-control); transform: translateY(-1px); }
        a:focus-visible { outline: 2px solid var(--ai-footer-focus); outline-offset: 2px; }
        a img { display: block; width: 2rem; height: 2rem; border-radius: .625rem; object-fit: cover; }
        @media (max-width: 1000px) { aside { grid-template-columns: minmax(0, 1fr); gap: 1rem; } ul { justify-content: flex-start; } }
        @media (prefers-reduced-motion: reduce) { a { transition: background-color 150ms ease, border-color 150ms ease; } a:hover { transform: none; } }
      \`;

      const aside = document.createElement('aside');
      aside.setAttribute('aria-label', 'Chat with AI about this product');
      const intro = document.createElement('div');
      intro.className = 'intro';
      const signal = document.createElement('span');
      signal.className = 'signal';
      signal.setAttribute('aria-hidden', 'true');
      const sparkle = document.createElementNS(SVG_NS, 'svg');
      sparkle.setAttribute('viewBox', '0 0 16 16');
      sparkle.setAttribute('aria-hidden', 'true');
      const sparklePath = document.createElementNS(SVG_NS, 'path');
      sparklePath.setAttribute('d', 'M8 1.5c.35 3.65 2.85 6.15 6.5 6.5-3.65.35-6.15 2.85-6.5 6.5C7.65 10.85 5.15 8.35 1.5 8 5.15 7.65 7.65 5.15 8 1.5Z');
      sparkle.append(sparklePath);
      signal.append(sparkle);
      const copy = document.createElement('div');
      const heading = document.createElement('h2');
      heading.className = 'title';
      heading.textContent = label;
      const description = document.createElement('p');
      description.className = 'description';
      description.textContent = 'Open a pre-filled question in a new tab with the assistant you already use.';
      const list = document.createElement('ul');
      for (const [id, providerName, buildUrl] of PROVIDERS) {
        if (!allowed.has(id)) continue;
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = buildUrl(prompt);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.dataset.aiProvider = id;
        link.title = providerName;
        link.setAttribute('aria-label', 'Ask ' + providerName + ' about ' + name + ' (opens in a new tab)');
        link.append(createProviderLogo(id));
        item.append(link);
        list.append(item);
      }
      copy.append(heading, description);
      intro.append(signal, copy);
      aside.append(intro, list);
      root.append(style, aside);
    }
  }

  if (!customElements.get('ai-chat-footer')) customElements.define('ai-chat-footer', AIChatFooter);

  const script = document.currentScript;
  const mount = () => {
    if (!script || script.dataset.auto === 'false') return;
    const footer = document.querySelector('ai-chat-footer') || document.createElement('ai-chat-footer');
    footer.setAttribute('product-name', script.dataset.name || footer.getAttribute('product-name') || document.title || 'this product');
    footer.setAttribute('product-url', script.dataset.url || footer.getAttribute('product-url') || window.location.origin);
    for (const attribute of ['label', 'prompt', 'providers', 'theme']) {
      if (script.dataset[attribute]) footer.setAttribute(attribute, script.dataset[attribute]);
    }
    const strip = document.querySelector('portfolio-project-strip');
    if (strip && script.dataset.compose !== 'false') strip.remove();
    if (!footer.isConnected) document.body.append(footer);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();`;

export function GET() {
  return new Response(source, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
      'Content-Type': 'text/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
