const BENCHMARK_SCHEMA = 'fleet.domain-rating-benchmark.v1';

export function validateDomainRatingBenchmark(
  benchmark,
  { now = new Date(), maxAgeDays = 120 } = {},
) {
  if (benchmark?.schema !== BENCHMARK_SCHEMA) {
    throw new Error(`Domain Rating benchmark must use ${BENCHMARK_SCHEMA}`);
  }
  if (
    benchmark.metric !== 'Ahrefs Domain Rating' ||
    benchmark.cohort?.provider !== 'Ahrefs'
  ) {
    throw new Error(
      'Domain Rating benchmark must identify Ahrefs as the metric and cohort provider',
    );
  }
  if (!isExternalHttpUrl(benchmark.cohort?.sourceUrl)) {
    throw new Error(
      'Domain Rating benchmark requires an attributed external source URL',
    );
  }
  if (
    /github\.com\/(?:sass-maker|significant-hobbies)|sassmaker\.com|significanthobbies\.com/i.test(
      benchmark.cohort.sourceUrl,
    )
  ) {
    throw new Error('Domain Rating benchmark cannot use a Fleet-owned cohort');
  }

  const observedAt = parseDate(benchmark.cohort?.observedAt, 'observedAt');
  parseDate(benchmark.cohort?.publishedAt, 'publishedAt');
  const ageDays = (now.getTime() - observedAt.getTime()) / 86_400_000;
  if (ageDays < 0 || ageDays > maxAgeDays) {
    throw new Error(
      `Domain Rating benchmark is stale or future-dated: ${ageDays.toFixed(1)} days old`,
    );
  }

  const bins = benchmark.cohort?.bins;
  if (!Array.isArray(bins) || bins.length === 0) {
    throw new Error('Domain Rating benchmark requires cohort bins');
  }
  let expectedMinimum = 0;
  let observedTotal = 0;
  for (const bin of bins) {
    if (
      bin?.minInclusive !== expectedMinimum ||
      !Number.isFinite(bin.maxExclusive) ||
      bin.maxExclusive <= bin.minInclusive ||
      !Number.isInteger(bin.count) ||
      bin.count < 0
    ) {
      throw new Error('Domain Rating benchmark bins must be contiguous and counted');
    }
    expectedMinimum = bin.maxExclusive;
    observedTotal += bin.count;
  }
  if (expectedMinimum !== 100) {
    throw new Error('Domain Rating benchmark bins must cover DR 0 through 100');
  }
  if (
    !Number.isInteger(benchmark.cohort.total) ||
    benchmark.cohort.total <= 0 ||
    observedTotal !== benchmark.cohort.total
  ) {
    throw new Error(
      `Domain Rating benchmark total mismatch: expected ${benchmark.cohort?.total}, observed ${observedTotal}`,
    );
  }

  return benchmark;
}

export function domainRatingPercentile(
  rawDomainRating,
  benchmark,
  options,
) {
  validateDomainRatingBenchmark(benchmark, options);
  if (rawDomainRating == null || rawDomainRating === '') {
    return null;
  }
  const raw = Number(rawDomainRating);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    return null;
  }

  const strictlyLowerCount = benchmark.cohort.bins
    .filter((bin) => bin.maxExclusive <= raw)
    .reduce((total, bin) => total + bin.count, 0);

  return {
    raw,
    percentileLowerBound:
      (strictlyLowerCount / benchmark.cohort.total) * 100,
    benchmarkProvider: benchmark.cohort.provider,
    benchmarkSourceUrl: benchmark.cohort.sourceUrl,
    benchmarkObservedAt: benchmark.cohort.observedAt,
    cohortSize: benchmark.cohort.total,
  };
}

function parseDate(value, label) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new Error(`Domain Rating benchmark requires a valid ${label}`);
  }
  return parsed;
}

function isExternalHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
