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
    if (provider === 'claude') add('path', { d: 'M12 2l2.5 7h7l-5.7 4.2 2.2 7-6-4.5-6 4.5 2.2-7L2.5 9h7L12 2z', fill: 'currentColor' });
    if (provider === 'chatgpt') {
      add('path', { d: 'M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
      add('circle', { cx: '12', cy: '12', r: '3', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
    }
    if (provider === 'gemini') add('path', { d: 'M12 2l3 7.5h7.5l-6 4.5 2.25 7.5-6.75-5-6.75 5 2.25-7.5-6-4.5H9L12 2z', fill: 'currentColor' });
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
        :host { --ai-footer-muted: color-mix(in srgb, currentColor 62%, transparent); --ai-footer-border: color-mix(in srgb, currentColor 18%, transparent); --ai-footer-focus: #2563eb; display: block; color: inherit; background: transparent; font: inherit; }
        :host([theme='light']) { color-scheme: light; }
        :host([theme='dark']) { color-scheme: dark; }
        * { box-sizing: border-box; }
        aside { display: grid; align-content: center; min-height: 11rem; padding: 1.5rem var(--ai-footer-edge, 1rem); border-block-start: 1px solid var(--ai-footer-border); }
        :host([integrated]) aside { height: 100%; padding: 1.25rem var(--ai-footer-edge, 1.25rem); border-block-start: 0; }
        p { margin: 0; }
        .eyebrow { display: flex; align-items: center; gap: .4rem; color: var(--ai-footer-muted); font-size: .64rem; font-weight: 750; letter-spacing: .1em; line-height: 1; text-transform: uppercase; }
        .eyebrow svg { width: .9rem; height: .9rem; fill: none; stroke: currentColor; stroke-width: 1.6; }
        .title { margin: .55rem 0 0; font-size: clamp(1rem, 1.4vw, 1.2rem); font-weight: 720; letter-spacing: -.025em; line-height: 1.2; }
        .description { max-width: 36rem; margin-top: .35rem; color: var(--ai-footer-muted); font-size: .74rem; line-height: 1.45; }
        ul { display: grid; grid-template-columns: repeat(3, max-content); gap: .45rem; margin: 1rem 0 0; padding: 0; list-style: none; }
        a { display: inline-flex; width: 100%; min-height: 2.75rem; align-items: center; gap: .5rem; padding: .35rem .72rem .35rem .35rem; border: 1px solid var(--ai-footer-border); border-radius: .65rem; color: inherit; font-size: .72rem; font-weight: 680; text-decoration: none; transition: background-color 140ms ease, border-color 140ms ease; }
        a:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
        a:focus-visible { outline: 2px solid var(--ai-footer-focus); outline-offset: 2px; }
        .mark { display: grid; width: 1.95rem; height: 1.95rem; place-items: center; border-radius: .45rem; background: color-mix(in srgb, currentColor 8%, transparent); }
        .mark svg { width: 1.05rem; height: 1.05rem; }
        @media (max-width: 1000px) { ul { grid-template-columns: repeat(2, minmax(0, 1fr)); } li:last-child:nth-child(odd) { grid-column: 1 / -1; width: calc(50% - .225rem); justify-self: center; } }
        @media (max-width: 480px) { aside { min-height: 0; } }
      \`;

      const aside = document.createElement('aside');
      aside.setAttribute('aria-label', 'Chat with AI about this product');
      const eyebrow = document.createElement('p');
      eyebrow.className = 'eyebrow';
      const sparkle = document.createElementNS(SVG_NS, 'svg');
      sparkle.setAttribute('viewBox', '0 0 16 16');
      sparkle.setAttribute('aria-hidden', 'true');
      const sparklePath = document.createElementNS(SVG_NS, 'path');
      sparklePath.setAttribute('d', 'M8 1.5c.35 3.65 2.85 6.15 6.5 6.5-3.65.35-6.15 2.85-6.5 6.5C7.65 10.85 5.15 8.35 1.5 8 5.15 7.65 7.65 5.15 8 1.5Z');
      sparkle.append(sparklePath);
      eyebrow.append(sparkle, document.createTextNode('AI shortcut'));
      const heading = document.createElement('h2');
      heading.className = 'title';
      heading.textContent = label;
      const description = document.createElement('p');
      description.className = 'description';
      description.textContent = 'Open a focused question in the assistant you already use.';
      const list = document.createElement('ul');
      for (const [id, providerName, buildUrl] of PROVIDERS) {
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
        icon.append(createProviderIcon(id));
        link.append(icon, document.createTextNode(providerName));
        item.append(link);
        list.append(item);
      }
      aside.append(eyebrow, heading, description, list);
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
        aside { display: grid; grid-template-columns: minmax(21rem, .72fr) minmax(0, 1.28fr); align-items: stretch; }
        .ai { min-width: 0; border-inline-end: 1px solid var(--fleet-footer-border); }
        .projects { display: grid; min-width: 0; align-content: center; }
        .projects-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .9rem var(--fleet-footer-edge, 1rem) 0; }
        .projects-head span { color: color-mix(in srgb, currentColor 62%, transparent); font-size: .64rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
        .projects-head a { min-height: 2.75rem; display: inline-flex; align-items: center; color: inherit; font-size: .72rem; font-weight: 680; text-underline-offset: .22em; }
        .projects-head a:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
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
      const projectsHead = document.createElement('div');
      projectsHead.className = 'projects-head';
      const projectsLabel = document.createElement('span');
      projectsLabel.textContent = 'More from the studio';
      const projectsLink = document.createElement('a');
      projectsLink.href = 'https://sassmaker.com/projects';
      projectsLink.textContent = 'View all projects ↗';
      projectsHead.append(projectsLabel, projectsLink);
      const projectsSlot = document.createElement('slot');
      projectsSlot.name = 'projects';
      projects.append(projectsHead, projectsSlot);
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
