const source = `(() => {
  'use strict';

  const PROVIDERS = [
    ['claude', 'Claude', (prompt) => 'https://claude.ai/new?q=' + encodeURIComponent(prompt)],
    ['chatgpt', 'ChatGPT', (prompt) => 'https://chatgpt.com/?q=' + encodeURIComponent(prompt)],
    ['gemini', 'Gemini', (prompt) => 'https://gemini.google.com/app?is_sa=1&is_sa_p=' + encodeURIComponent(prompt)],
    ['perplexity', 'Perplexity', (prompt) => 'https://www.perplexity.ai/?q=' + encodeURIComponent(prompt)],
    ['grok', 'Grok', (prompt) => 'https://grok.com/?q=' + encodeURIComponent(prompt)],
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const createProviderIcon = (provider) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const add = (tag, attributes) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      svg.append(node);
    };
    if (provider === 'claude') add('path', { d: 'M12 3v18M3 12h18M5.65 5.65l12.7 12.7M18.35 5.65l-12.7 12.7', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.4', 'stroke-linecap': 'round' });
    if (provider === 'chatgpt') {
      add('path', { d: 'M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
      add('circle', { cx: '12', cy: '12', r: '3', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
    }
    if (provider === 'gemini') add('path', { d: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81', fill: 'currentColor' });
    if (provider === 'perplexity') {
      add('circle', { cx: '12', cy: '12', r: '9', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
      add('circle', { cx: '12', cy: '12', r: '4', fill: 'currentColor' });
    }
    if (provider === 'grok') add('path', { d: 'M12 2L2 22h6l4-8 4 8h6L12 2zm0 6l3 6H9l3-6z', fill: 'currentColor' });
    return svg;
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
        @media (max-width: 1000px) { aside { grid-template-columns: minmax(0, 1fr); gap: 1rem; } ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); justify-content: stretch; } li:last-child:nth-child(odd) { grid-column: 1 / -1; width: calc(50% - .25rem); justify-self: center; } li:last-child:nth-child(odd) a { justify-content: center; } }
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
        link.setAttribute('aria-label', 'Ask ' + providerName + ' about ' + name + ' (opens in a new tab)');
        const icon = document.createElement('span');
        icon.className = 'mark';
        icon.setAttribute('aria-hidden', 'true');
        icon.append(createProviderIcon(id));
        link.append(icon, document.createTextNode(providerName));
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
