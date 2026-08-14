import { type CSSProperties, useEffect, useMemo, useState } from 'react';
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

export function PortfolioProjectStrip({
  projects,
  catalogUrl = DEFAULT_CATALOG_URL,
  currentProjectId,
  label = 'More from Sarthak',
  theme = 'auto',
  className = '',
  speed = 42,
}: PortfolioProjectStripProps) {
  const initialProjects = useMemo(
    () => normalizeProjects(projects ?? DEFAULT_PROJECTS),
    [projects]
  );
  const [catalog, setCatalog] = useState(initialProjects);
  const [isPaused, setIsPaused] = useState(false);

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
        <div className="portfolio-project-strip__meta">
          <span className="portfolio-project-strip__label">{label}</span>
          {shouldLoop ? (
            <button
              className="portfolio-project-strip__motion-control"
              type="button"
              aria-pressed={isPaused}
              onClick={() => setIsPaused((paused) => !paused)}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          ) : null}
        </div>
        <div className="portfolio-project-strip__viewport">
          <ul
            className="portfolio-project-strip__track"
            data-loop={shouldLoop}
            data-paused={isPaused}
            style={{ '--portfolio-strip-speed': `${duration}s` } as CSSProperties}
          >
            {items.map((project, index) => {
              const duplicate = shouldLoop && index >= visibleProjects.length;
              const showSeparator = shouldLoop || index < items.length - 1;
              return (
                <li
                  key={`${project.id}-${duplicate ? 'duplicate' : 'primary'}`}
                  className="portfolio-project-strip__item"
                  aria-hidden={duplicate}
                >
                  <a
                    href={project.url}
                    className="portfolio-project-strip__link"
                    tabIndex={duplicate ? -1 : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={
                      project.description ? `${project.name}: ${project.description}` : project.name
                    }
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
      </div>
    </aside>
  );
}
