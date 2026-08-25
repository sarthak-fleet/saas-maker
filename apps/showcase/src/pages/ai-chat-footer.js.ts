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
  const CHATGPT_SEGMENT = 'M1107.3 299.1c-197.999 0-373.9 127.3-435.2 315.3L650 743.5v427.9c0 21.4 11 40.4 29.4 51.4l344.5 198.515V833.3h.1v-27.9L1372.7 604c33.715-19.52 70.44-32.857 108.47-39.828L1447.6 450.3C1361 353.5 1237.1 298.5 1107.3 299.1zm0 117.5-.6.6c79.699 0 156.3 27.5 217.6 78.4-2.5 1.2-7.4 4.3-11 6.1L952.8 709.3c-18.4 10.4-29.4 30-29.4 51.4V1248l-155.1-89.4V755.8c-.1-187.099 151.601-338.9 339-339.2z';
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
    if (provider === 'claude') add('path', { d: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z', fill: 'currentColor' });
    if (provider === 'chatgpt') {
      svg.setAttribute('viewBox', '0 0 2406 2406');
      for (const rotation of [0, 60, 120, 180, 240, 300]) {
        add('path', { d: CHATGPT_SEGMENT, fill: 'currentColor', ...(rotation ? { transform: 'rotate(' + rotation + ' 1203 1203)' } : {}) });
      }
    }
    if (provider === 'gemini') add('path', { d: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81', fill: 'currentColor' });
    if (provider === 'perplexity') add('path', { d: 'M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z', fill: 'currentColor' });
    if (provider === 'grok') {
      svg.setAttribute('viewBox', '0 0 512 512');
      add('path', { d: 'M210.484 312.759 343.465 210.383c6.519-5.019 15.837-3.061 18.943 4.734 16.35 41.114 9.046 90.523-23.483 124.446-32.528 33.924-77.788 41.364-119.157 24.42l-45.191 21.82c64.817 46.205 143.527 34.778 192.712-16.552 39.014-40.687 51.097-96.147 39.799-146.16l.102.107c-16.383-73.472 4.028-102.839 45.84-162.891.99-1.424 1.98-2.848 2.97-4.307l-55.022 57.382v-.178L210.45 312.794', fill: 'currentColor' });
      add('path', { d: 'M183.042 337.641c-46.523-46.347-38.502-118.074 1.194-159.438 29.354-30.613 77.447-43.107 119.43-24.739l45.089-21.714c-8.123-6.123-18.534-12.708-30.48-17.336-53.998-23.173-118.645-11.64-162.54 34.102-42.222 44.033-55.499 111.738-32.699 169.511 17.033 43.179-10.888 73.721-39.013 104.548C74.056 433.503 64.055 444.431 56 456l127.007-118.323', fill: 'currentColor' });
    }
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
        a[data-ai-provider='grok'] .mark { --provider-color: #fff; background: #111; }
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
