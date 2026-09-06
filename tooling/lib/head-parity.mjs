/**
 * HEAD/GET parity — does a route answer the same to a HEAD probe as to a GET?
 *
 * The blind spot this closes (sass-maker/saas-maker#93): sassmaker.com returned
 * 404 to HEAD on every interior route while returning 200 to GET, and scored
 * S-tier, because the auditor only ever probed with GET. Link checkers, crawlers
 * and agent fetchers commonly send HEAD first; those clients saw a directory
 * whose pages did not exist.
 *
 * Each pair differs only in the method: the HEAD request carries the same
 * Accept header as the GET it is compared with, so content negotiation is never
 * mistaken for a routing defect.
 *
 * Cost control: the compared set is the fixed agent endpoints — whose GET
 * statuses the audit already has — plus a small deterministic sample of sitemap
 * routes. That is enough to catch a whole-site routing asymmetry, which is how
 * this class of defect always presents, without doubling a 250-route sweep.
 */

/** 200 → 2, 404 → 4, network error → 0. */
export function statusClass(status) {
  const value = Number(status) || 0;
  return value > 0 ? Math.floor(value / 100) : 0;
}

/**
 * @param {{
 *   probes: Array<{ url: string, label?: string, status: number, accept?: string }>,
 *   head: (url: string, accept?: string) => Promise<{ status: number, error?: string }>,
 *   concurrency?: number,
 * }} input
 */
export async function gradeHeadParity({ probes, head, concurrency = 4 }) {
  const comparable = (probes ?? []).filter(
    (probe) => probe?.url && statusClass(probe.status) !== 0
  );
  if (comparable.length === 0) {
    return {
      status: 'skip',
      detail: 'no GET-probed routes available to compare',
      data: { checked: 0, matched: 0, mismatches: [] },
    };
  }

  const results = await mapLimit(comparable, concurrency, async (probe) => {
    const response = await head(probe.url, probe.accept);
    const headStatus = Number(response?.status) || 0;
    return {
      url: probe.url,
      label: probe.label ?? pathOf(probe.url),
      get: Number(probe.status) || 0,
      head: headStatus,
      matched: statusClass(headStatus) === statusClass(probe.status),
    };
  });

  const mismatches = results
    .filter((result) => !result.matched)
    .map(({ label, get, head: headStatus }) => ({
      route: label,
      get,
      head: headStatus,
    }));
  const matched = results.length - mismatches.length;

  if (mismatches.length === 0) {
    return {
      status: 'pass',
      detail: `${matched}/${results.length} probed routes answer HEAD as they answer GET`,
      data: { checked: results.length, matched, mismatches: [] },
    };
  }
  return {
    status: 'fail',
    detail:
      `${mismatches.length}/${results.length} routes disagree between HEAD and GET: ` +
      mismatches
        .slice(0, 5)
        .map((m) => `${m.route} HEAD ${m.head || 'err'} vs GET ${m.get}`)
        .join(', ') +
      (mismatches.length > 5 ? `, +${mismatches.length - 5} more` : ''),
    data: { checked: results.length, matched, mismatches: mismatches.slice(0, 20) },
  };
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, values.length)) }, () => worker())
  );
  return results;
}
