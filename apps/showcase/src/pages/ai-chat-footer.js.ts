const source = `(() => {
  'use strict';

  const PROVIDERS = [
    ['claude', 'Claude', 'C', (prompt) => 'https://claude.ai/new?q=' + encodeURIComponent(prompt)],
    ['chatgpt', 'ChatGPT', 'O', (prompt) => 'https://chatgpt.com/?q=' + encodeURIComponent(prompt)],
    ['gemini', 'Gemini', 'G', (prompt) => 'https://gemini.google.com/app?is_sa=1&is_sa_p=' + encodeURIComponent(prompt)],
    ['perplexity', 'Perplexity', 'P', (prompt) => 'https://www.perplexity.ai/?q=' + encodeURIComponent(prompt)],
    ['grok', 'Grok', 'X', (prompt) => 'https://grok.com/?q=' + encodeURIComponent(prompt)],
  ];

  const interpolate = (template, name, url) => template
    .replaceAll('{companyName}', name)
    .replaceAll('{companyUrl}', url);

  class AIChatFooter extends HTMLElement {
    connectedCallback() { this.render(); }

    render() {
      const name = this.getAttribute('product-name') || 'this product';
      const url = this.getAttribute('product-url') || window.location.origin;
      const label = this.getAttribute('label') || 'Chat with us through AI about ' + name;
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
        :host { --ai-footer-muted: color-mix(in srgb, currentColor 62%, transparent); --ai-footer-border: color-mix(in srgb, currentColor 18%, transparent); --ai-footer-focus: #2563eb; display: block; color: inherit; background: transparent; font: inherit; }
        :host([theme='light']) { color-scheme: light; }
        :host([theme='dark']) { color-scheme: dark; }
        * { box-sizing: border-box; }
        aside { padding: 1.5rem var(--ai-footer-edge, 1rem); border-block-start: 1px solid var(--ai-footer-border); }
        :host([integrated]) aside { height: 100%; padding: 1rem var(--ai-footer-edge, 1rem); border-block-start: 0; }
        p { margin: 0; color: var(--ai-footer-muted); font-size: .75rem; line-height: 1.4; }
        ul { display: flex; flex-wrap: wrap; gap: .5rem; margin: .75rem 0 0; padding: 0; list-style: none; }
        a { display: inline-flex; min-height: 2.75rem; align-items: center; gap: .5rem; padding: .375rem .75rem .375rem .375rem; border: 1px solid var(--ai-footer-border); border-radius: 999px; color: inherit; font-size: .75rem; font-weight: 650; text-decoration: none; }
        a:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
        a:focus-visible { outline: 2px solid var(--ai-footer-focus); outline-offset: 2px; }
        .mark { display: grid; width: 1.8rem; height: 1.8rem; place-items: center; border-radius: 50%; background: currentColor; font-size: .64rem; }
        .mark span { color: Canvas; }
      \`;

      const aside = document.createElement('aside');
      aside.setAttribute('aria-label', 'Chat with AI about this product');
      const heading = document.createElement('p');
      heading.textContent = label;
      const list = document.createElement('ul');
      for (const [id, providerName, mark, buildUrl] of PROVIDERS) {
        if (!allowed.has(id)) continue;
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = buildUrl(prompt);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.dataset.aiProvider = id;
        link.setAttribute('aria-label', 'Ask ' + providerName + ' about ' + name);
        const icon = document.createElement('span');
        icon.className = 'mark';
        icon.setAttribute('aria-hidden', 'true');
        const iconText = document.createElement('span');
        iconText.textContent = mark;
        icon.append(iconText);
        link.append(icon, document.createTextNode(providerName));
        item.append(link);
        list.append(item);
      }
      aside.append(heading, list);
      root.append(style, aside);
    }
  }

  if (!customElements.get('ai-chat-footer')) customElements.define('ai-chat-footer', AIChatFooter);

  class FleetFooterExtension extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = \`
        :host {
          --fleet-footer-border: color-mix(in srgb, currentColor 16%, transparent);
          --fleet-footer-surface: color-mix(in srgb, currentColor 3%, transparent);
          display: block;
          width: 100%;
          color: inherit;
          background: var(--fleet-footer-surface);
          border-block-start: 1px solid var(--fleet-footer-border);
          font: inherit;
        }
        * { box-sizing: border-box; }
        aside { display: grid; grid-template-columns: minmax(17rem, .42fr) minmax(0, 1fr); align-items: stretch; }
        .ai { min-width: 0; border-inline-end: 1px solid var(--fleet-footer-border); }
        .projects { min-width: 0; align-self: center; }
        ::slotted(*) { min-width: 0; }
        @media (max-width: 760px) {
          aside { grid-template-columns: minmax(0, 1fr); }
          .ai { border-inline-end: 0; border-block-end: 1px solid var(--fleet-footer-border); }
        }
      \`;
      const region = document.createElement('aside');
      region.setAttribute('aria-label', 'Explore this product and more from the Fleet');
      const ai = document.createElement('div');
      ai.className = 'ai';
      const aiSlot = document.createElement('slot');
      aiSlot.name = 'ai';
      ai.append(aiSlot);
      const projects = document.createElement('div');
      projects.className = 'projects';
      const projectsSlot = document.createElement('slot');
      projectsSlot.name = 'projects';
      projects.append(projectsSlot);
      region.append(ai, projects);
      root.append(style, region);
    }
  }

  if (!customElements.get('fleet-footer-extension')) {
    customElements.define('fleet-footer-extension', FleetFooterExtension);
  }

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
    if (!strip || script.dataset.compose === 'false') {
      if (!footer.isConnected) document.body.append(footer);
      return;
    }
    const extension = document.querySelector('fleet-footer-extension') || document.createElement('fleet-footer-extension');
    footer.setAttribute('integrated', '');
    footer.slot = 'ai';
    strip.setAttribute('integrated', '');
    strip.slot = 'projects';
    extension.append(footer, strip);
    if (!extension.isConnected) document.body.append(extension);
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
