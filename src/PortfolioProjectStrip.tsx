import { type CSSProperties, useEffect, useId, useMemo, useState } from 'react';
import { DEFAULT_PROJECTS } from './catalog';
import type { PortfolioProject, PortfolioProjectStripProps } from './types';
import './index.css';

const REQUEST_TIMEOUT_MS = 800;
export const DEFAULT_CATALOG_URL = 'https://sassmaker.com/projects.json';

function isProject(value: unknown): value is PortfolioProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<PortfolioProject>;
  try {
    const url = new URL(project.url ?? '');
    return (
      typeof project.id === 'string' &&
      project.id.length > 0 &&
      typeof project.name === 'string' &&
      project.name.length > 0 &&
      (url.protocol === 'http:' || url.protocol === 'https:')
    );
  } catch {
    return false;
  }
}

export function normalizeProjects(value: unknown): PortfolioProject[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter(isProject).filter((project) => {
    if (seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
}

async function fetchCatalog(url: string, signal: AbortSignal): Promise<PortfolioProject[]> {
  const response = await fetch(url, {
    signal,
    headers: { accept: 'application/json' },
    cache: 'force-cache',
  });
  if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
  return normalizeProjects(await response.json());
}

export function withReferralSource(url: string, currentProjectId?: string): string {
  if (!currentProjectId) return url;
  try {
    const destination = new URL(url);
    destination.searchParams.set('ref', currentProjectId);
    return destination.toString();
  } catch {
    return url;
  }
}

function transformOffsetX(transform: string): number {
  if (transform === 'none') return 0;
  const values = transform
    .slice(transform.indexOf('(') + 1, -1)
    .split(',')
    .map(Number);
  const offset = transform.startsWith('matrix3d') ? values[12] : values[4];
  return Number.isFinite(offset) ? offset : 0;
}

function keepFocusedLinkVisible(link: HTMLAnchorElement): void {
  const viewport = link.closest<HTMLElement>('.portfolio-project-strip__viewport');
  const track = link.closest<HTMLElement>('.portfolio-project-strip__track');
  if (!viewport || !track) return;
  const viewportRect = viewport.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  const currentOffset = transformOffsetX(window.getComputedStyle(track).transform);
  const safeInset = 16;
  let correction = 0;
  if (linkRect.left < viewportRect.left + safeInset) {
    correction = viewportRect.left + safeInset - linkRect.left;
  } else if (linkRect.right > viewportRect.right - safeInset) {
    correction = viewportRect.right - safeInset - linkRect.right;
  }
  track.style.animation = 'none';
  track.style.transform = `translateX(${currentOffset + correction}px)`;
}

function resumeTrackAfterFocus(link: HTMLAnchorElement, nextTarget: EventTarget | null): void {
  const viewport = link.closest<HTMLElement>('.portfolio-project-strip__viewport');
  if (nextTarget instanceof Node && viewport?.contains(nextTarget)) return;
  const track = link.closest<HTMLElement>('.portfolio-project-strip__track');
  track?.style.removeProperty('animation');
  track?.style.removeProperty('transform');
}

export function PortfolioProjectStrip({
  projects,
  catalogUrl = DEFAULT_CATALOG_URL,
  currentProjectId,
  label = 'Other projects by Sarthak',
  theme = 'auto',
  className = '',
  speed = 42,
}: PortfolioProjectStripProps) {
  const initialProjects = useMemo(
    () => normalizeProjects(projects ?? DEFAULT_PROJECTS),
    [projects]
  );
  const [catalog, setCatalog] = useState(initialProjects);
  const [activeDescription, setActiveDescription] = useState<string | null>(null);
  const tooltipId = useId();

  useEffect(() => setCatalog(initialProjects), [initialProjects]);

  useEffect(() => {
    if (!catalogUrl) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    void fetchCatalog(catalogUrl, controller.signal)
      .then((next) => {
        if (next.length > 0) setCatalog(next);
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [catalogUrl]);

  const visibleProjects = catalog.filter((project) => project.id !== currentProjectId);
  if (visibleProjects.length === 0) return null;
  const shouldLoop = visibleProjects.length > 2;
  const items = shouldLoop ? [...visibleProjects, ...visibleProjects] : visibleProjects;
  const themeAttr = theme === 'auto' ? undefined : theme;
  const duration = Number.isFinite(speed) ? Math.max(20, speed) : 42;

  return (
    <aside
      className={`portfolio-project-strip ${className}`}
      data-theme={themeAttr}
      aria-label={label}
    >
      <div className="portfolio-project-strip__inner">
        <div className="portfolio-project-strip__viewport">
          <ul
            className="portfolio-project-strip__track"
            data-loop={shouldLoop}
            style={{ '--portfolio-strip-speed': `${duration}s` } as CSSProperties}
          >
            {items.map((project, index) => {
              const duplicate = shouldLoop && index >= visibleProjects.length;
              const showSeparator = shouldLoop || index < items.length - 1;
              return (
                <li
                  key={`${project.id}-${duplicate ? 'duplicate' : 'primary'}`}
                  className={`portfolio-project-strip__item${duplicate ? ' portfolio-project-strip__duplicate' : ''}`}
                  aria-hidden={duplicate}
                >
                  <a
                    href={withReferralSource(project.url, currentProjectId)}
                    className="portfolio-project-strip__link"
                    tabIndex={duplicate ? -1 : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-describedby={project.description ? tooltipId : undefined}
                    aria-label={`${project.name} (opens in a new tab)`}
                    onPointerEnter={() => setActiveDescription(project.description ?? null)}
                    onPointerLeave={() => setActiveDescription(null)}
                    onFocus={(event) => {
                      setActiveDescription(project.description ?? null);
                      keepFocusedLinkVisible(event.currentTarget);
                    }}
                    onBlur={(event) => {
                      setActiveDescription(null);
                      resumeTrackAfterFocus(event.currentTarget, event.relatedTarget);
                    }}
                  >
                    {project.name}
                  </a>
                  {showSeparator ? (
                    <span className="portfolio-project-strip__dot" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
        <div
          id={tooltipId}
          className="portfolio-project-strip__tooltip"
          role="tooltip"
          hidden={!activeDescription}
        >
          {activeDescription}
        </div>
      </div>
    </aside>
  );
}
