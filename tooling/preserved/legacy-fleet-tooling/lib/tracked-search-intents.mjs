const TRACKED_KINDS = new Set(['brand', 'category']);

export function buildTrackedSearchIntentMap({
  products,
  observatory,
}) {
  const expectedProducts = Array.isArray(products) ? products : [];
  const configuredProducts = Array.isArray(observatory?.products)
    ? observatory.products
    : [];
  const expectedById = new Map();

  for (const product of expectedProducts) {
    if (!product?.id || expectedById.has(product.id)) {
      throw new Error(
        `Tracked search intents require unique canonical product ids; received ${product?.id || 'blank'}`,
      );
    }
    expectedById.set(product.id, product);
  }

  const configuredById = new Map();
  const seenQueryIds = new Set();
  for (const product of configuredProducts) {
    if (!product?.id || configuredById.has(product.id)) {
      throw new Error(
        `Tracked search intents contain a duplicate or blank product id: ${product?.id || 'blank'}`,
      );
    }
    if (!expectedById.has(product.id)) {
      throw new Error(
        `Tracked search intents contain an unknown product: ${product.id}`,
      );
    }

    const expectedOrigin = normalizeOrigin(expectedById.get(product.id).url);
    const configuredOrigin = normalizeOrigin(product.origin);
    if (expectedOrigin !== configuredOrigin) {
      throw new Error(
        `Tracked search intent origin mismatch for ${product.id}: expected ${expectedOrigin}, received ${configuredOrigin}`,
      );
    }

    const intents = [];
    for (const query of product.queries ?? []) {
      const id = query?.qid?.trim();
      const kind = query?.kind?.trim();
      const text = query?.q?.trim();
      if (!id || !kind || !text) {
        throw new Error(
          `Tracked search intent for ${product.id} requires qid, kind, and q`,
        );
      }
      if (!TRACKED_KINDS.has(kind)) {
        continue;
      }
      if (seenQueryIds.has(id)) {
        throw new Error(`Tracked search intent id is duplicated: ${id}`);
      }
      seenQueryIds.add(id);
      intents.push({ id, kind, query: text });
    }
    if (intents.length === 0) {
      throw new Error(
        `Tracked search intents are missing a brand or category query for ${product.id}`,
      );
    }
    configuredById.set(product.id, intents);
  }

  const missing = [...expectedById.keys()].filter(
    (id) => !configuredById.has(id),
  );
  if (missing.length > 0) {
    throw new Error(
      `Tracked search intents are missing canonical products: ${missing.join(', ')}`,
    );
  }

  return configuredById;
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Tracked search intent origin must be an absolute URL: ${value}`);
  }
}
