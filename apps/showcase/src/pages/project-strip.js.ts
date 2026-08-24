import { portfolioProjects } from '../lib/portfolio-projects';

const catalog = JSON.stringify(portfolioProjects)
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');

const source = String.raw`(() => {
  'use strict';

  const CATALOG_URL = 'https://sassmaker.com/projects.json';
  const INITIAL_PROJECTS = ${catalog};
  const REQUEST_TIMEOUT_MS = 800;
  const css = ${JSON.stringify(String.raw`
    :host {
      --portfolio-strip-bg: color-mix(in srgb, currentColor 3%, transparent);
      --portfolio-strip-text: currentColor;
      --portfolio-strip-muted: color-mix(in srgb, currentColor 70%, transparent);
      --portfolio-strip-border: color-mix(in srgb, currentColor 12%, transparent);
      --portfolio-strip-focus: #2563eb;
      --portfolio-strip-separator-size: 1rem;
      --portfolio-strip-tooltip-size: .75rem;
      display: block;
      width: 100%;
      border-block: 1px solid var(--portfolio-strip-border);
      background: var(--portfolio-strip-bg);
      color: var(--portfolio-strip-text);
      font-family: inherit;
      box-sizing: border-box;
    }
    :host([theme='light']) {
      --portfolio-strip-bg: #fafaf9;
      --portfolio-strip-text: #292524;
      --portfolio-strip-muted: #6f6964;
      --portfolio-strip-border: #e7e5e4;
    }
    :host([theme='dark']) {
      --portfolio-strip-bg: #171717;
      --portfolio-strip-text: #f5f5f4;
      --portfolio-strip-muted: #a8a29e;
      --portfolio-strip-border: #30302f;
    }
    :host([integrated]) { border-block: 0; background: transparent; }
    *, *::before, *::after { box-sizing: border-box; }
    .inner { position: relative; display: flex; min-height: 2.75rem; align-items: center; padding: 0 1rem; }
    a:focus-visible { outline: 2px solid var(--portfolio-strip-focus); outline-offset: 2px; }
    .viewport { width: 100%; min-width: 0; overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 1rem, #000 calc(100% - 1rem), transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 1rem, #000 calc(100% - 1rem), transparent); }
    .track { display: flex; width: max-content; align-items: center; animation: portfolio-strip-marquee var(--portfolio-strip-speed, 42s) linear infinite; will-change: transform; }
    .viewport:hover .track { animation-play-state: paused; }
    .viewport:focus-within .track { animation-play-state: paused; }
    ul { display: flex; align-items: center; margin: 0; padding: 0; list-style: none; }
    li { position: relative; display: inline-flex; align-items: center; white-space: nowrap; }
    a { position: relative; display: inline-flex; min-height: 2.75rem; align-items: center; border-radius: .2rem; color: var(--portfolio-strip-text); font-size: .8125rem; text-decoration: none; transition: color 150ms ease; }
    a:hover { text-decoration: underline; text-underline-offset: .2em; }
    .dot { padding: 0 .7rem; color: var(--portfolio-strip-muted); font-size: var(--portfolio-strip-separator-size); }
    .tooltip { position: absolute; z-index: 2; bottom: calc(100% + .5rem); left: 50%; width: max-content; max-width: min(22rem, 80vw); padding: .55rem .7rem; border: 1px solid var(--portfolio-strip-border); border-radius: .4rem; background: #171717; color: #f5f5f4; box-shadow: 0 8px 24px rgb(0 0 0 / .18); font-size: var(--portfolio-strip-tooltip-size); font-weight: 400; line-height: 1.35; pointer-events: none; transform: translateX(-50%); white-space: normal; }
    .tooltip[hidden] { display: none; }
    @keyframes portfolio-strip-marquee { to { transform: translateX(-50%); } }
    @media (prefers-reduced-motion: reduce) {
      .track { animation: none; }
      .viewport { overflow-x: auto; mask-image: none; -webkit-mask-image: none; }
      .duplicate { display: none; }
    }
    @media (hover: none), (pointer: coarse) {
      .track { animation: none; }
      .viewport { overflow-x: auto; mask-image: none; -webkit-mask-image: none; }
      .duplicate { display: none; }
    }
    @media (max-width: 560px) {
      .inner { padding: 0 .875rem; }
    }
  `)};

  const validProjects = (value) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter((project) => {
      if (!project || typeof project !== 'object' || typeof project.id !== 'string' || !project.id || typeof project.name !== 'string' || !project.name || seen.has(project.id)) return false;
      try {
        const url = new URL(project.url);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      } catch { return false; }
      seen.add(project.id);
      return true;
    });
  };

  const withReferralSource = (url, currentProjectId) => {
    if (!currentProjectId) return url;
    try {
      const destination = new URL(url);
      destination.searchParams.set('ref', currentProjectId);
      return destination.toString();
    } catch { return url; }
  };

  class PortfolioProjectStrip extends HTMLElement {
    constructor() {
      super();
      this.projects = INITIAL_PROJECTS;
      this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
      this.render();
      this.revalidate();
    }

    render() {
      const current = this.getAttribute('current-project') || '';
      const label = this.getAttribute('label') || 'Other projects by Sarthak';
      const speed = Math.max(20, Number(this.getAttribute('speed')) || 42);
      const projects = validProjects(this.projects).filter((project) => project.id !== current);
      if (!projects.length) { this.hidden = true; return; }
      this.hidden = false;
      const tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      tooltip.id = 'portfolio-project-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.hidden = true;
      const showDescription = (project) => {
        if (!project.description) return;
        tooltip.textContent = project.description;
        tooltip.hidden = false;
      };
      const hideDescription = () => { tooltip.hidden = true; };
      let viewport;
      let track;
      const transformOffsetX = (transform) => {
        if (transform === 'none') return 0;
        const values = transform.slice(transform.indexOf('(') + 1, -1).split(',').map(Number);
        const offset = transform.startsWith('matrix3d') ? values[12] : values[4];
        return Number.isFinite(offset) ? offset : 0;
      };
      const keepFocusedLinkVisible = (link) => {
        const viewportRect = viewport.getBoundingClientRect();
        const linkRect = link.getBoundingClientRect();
        const currentOffset = transformOffsetX(getComputedStyle(track).transform);
        const safeInset = 16;
        let correction = 0;
        if (linkRect.left < viewportRect.left + safeInset) correction = viewportRect.left + safeInset - linkRect.left;
        else if (linkRect.right > viewportRect.right - safeInset) correction = viewportRect.right - safeInset - linkRect.right;
        track.style.animation = 'none';
        track.style.transform = 'translateX(' + (currentOffset + correction) + 'px)';
      };
      const resumeTrackAfterFocus = (nextTarget) => {
        if (nextTarget instanceof Node && viewport.contains(nextTarget)) return;
        track.style.removeProperty('animation');
        track.style.removeProperty('transform');
      };
      const list = (duplicate = false) => {
        const ul = document.createElement('ul');
        if (duplicate) { ul.className = 'duplicate'; ul.setAttribute('aria-hidden', 'true'); }
        for (const project of projects) {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = withReferralSource(project.url, current);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = project.name;
          if (duplicate) link.tabIndex = -1;
          if (project.description) {
            link.setAttribute('aria-label', project.name + ' (opens in a new tab)');
            link.setAttribute('aria-describedby', tooltip.id);
            link.addEventListener('pointerenter', () => showDescription(project));
            link.addEventListener('pointerleave', hideDescription);
            link.addEventListener('focus', () => {
              showDescription(project);
              keepFocusedLinkVisible(link);
            });
            link.addEventListener('blur', (event) => {
              hideDescription();
              resumeTrackAfterFocus(event.relatedTarget);
            });
          } else {
            link.setAttribute('aria-label', project.name + ' (opens in a new tab)');
            link.addEventListener('focus', () => keepFocusedLinkVisible(link));
            link.addEventListener('blur', (event) => resumeTrackAfterFocus(event.relatedTarget));
          }
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.setAttribute('aria-hidden', 'true');
          dot.textContent = '·';
          item.append(link, dot);
          ul.append(item);
        }
        return ul;
      };

      const aside = document.createElement('aside');
      aside.setAttribute('aria-label', label);
      const inner = document.createElement('div');
      inner.className = 'inner';
      viewport = document.createElement('div');
      viewport.className = 'viewport';
      track = document.createElement('div');
      track.className = 'track';
      track.style.setProperty('--portfolio-strip-speed', speed + 's');
      track.append(list(), list(true));
      viewport.append(track);
      inner.append(viewport, tooltip);
      aside.append(inner);
      if ('adoptedStyleSheets' in this.shadowRoot && typeof CSSStyleSheet !== 'undefined') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        this.shadowRoot.adoptedStyleSheets = [sheet];
        this.shadowRoot.replaceChildren(aside);
      } else {
        const style = document.createElement('style');
        style.textContent = css;
        this.shadowRoot.replaceChildren(style, aside);
      }
    }

    async revalidate() {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(CATALOG_URL, { headers: { accept: 'application/json' }, cache: 'force-cache', signal: controller.signal });
        if (!response.ok) return;
        const projects = validProjects(await response.json());
        if (projects.length) { this.projects = projects; this.render(); }
      } catch {} finally { window.clearTimeout(timeout); }
    }
  }

  if (!customElements.get('portfolio-project-strip')) customElements.define('portfolio-project-strip', PortfolioProjectStrip);
  const script = document.currentScript;
  const mount = () => {
    if (!script || script.dataset.auto === 'false' || document.querySelector('portfolio-project-strip')) return;
    const strip = document.createElement('portfolio-project-strip');
    if (script.dataset.project) strip.setAttribute('current-project', script.dataset.project);
    if (script.dataset.label) strip.setAttribute('label', script.dataset.label);
    if (script.dataset.theme) strip.setAttribute('theme', script.dataset.theme);
    if (script.dataset.speed) strip.setAttribute('speed', script.dataset.speed);
    document.body.append(strip);
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
