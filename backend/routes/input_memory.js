const express = require("express");

const router = express.Router();

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_LIMIT = 50;
const SCOPE_ORDER_FORM = "order-form";

const scopeCache = new Map();

function normalizeSuggestionValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function sortSuggestions(items, limit = DEFAULT_LIMIT) {
  return items
    .sort((left, right) => {
      const frequencyGap = (right.frequency || 0) - (left.frequency || 0);
      if (frequencyGap !== 0) {
        return frequencyGap;
      }

      const rightTime = right.last_used_at ? new Date(right.last_used_at).getTime() : 0;
      const leftTime = left.last_used_at ? new Date(left.last_used_at).getTime() : 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      return String(left.value).localeCompare(String(right.value), "zh-CN");
    })
    .slice(0, limit);
}

function mergeSuggestionRows(targetMap, rows, sourceName) {
  rows.forEach((row) => {
    const value = normalizeSuggestionValue(row.value);
    if (!value) {
      return;
    }

    const key = value.toLocaleLowerCase();
    const current = targetMap.get(key) || {
      value,
      frequency: 0,
      last_used_at: null,
      sources: [],
    };

    current.frequency += Number(row.frequency || 0);

    const nextTime = toIsoString(row.last_used_at);
    if (nextTime) {
      const existingTime = current.last_used_at ? new Date(current.last_used_at).getTime() : 0;
      const candidateTime = new Date(nextTime).getTime();
      if (candidateTime > existingTime) {
        current.last_used_at = nextTime;
      }
    }

    if (!current.sources.includes(sourceName)) {
      current.sources.push(sourceName);
    }

    targetMap.set(key, current);
  });
}

async function queryGroupedSuggestions(db, sql) {
  if (!db) {
    return [];
  }

  const [rows] = await db.query(sql);
  return rows.map((row) => ({
    value: row.value,
    frequency: Number(row.frequency || 0),
    last_used_at: row.last_used_at || null,
  }));
}

async function buildOrderFormSuggestions(orderDb, userDb) {
  const [
    orderCompanies,
    profileCompanies,
    orderBusinessTypes,
    orderOrigins,
    orderDestinations,
    orderTradeTerms,
    orderProductNames,
    productCatalogNames,
  ] = await Promise.all([
    queryGroupedSuggestions(
      orderDb,
      `
        SELECT
          TRIM(company_name) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM orders
        WHERE company_name IS NOT NULL AND TRIM(company_name) <> ''
        GROUP BY TRIM(company_name)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
    queryGroupedSuggestions(
      userDb,
      `
        SELECT
          TRIM(company_name) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM user_profiles
        WHERE company_name IS NOT NULL AND TRIM(company_name) <> ''
        GROUP BY TRIM(company_name)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
    queryGroupedSuggestions(
      orderDb,
      `
        SELECT
          TRIM(business_type) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM orders
        WHERE business_type IS NOT NULL AND TRIM(business_type) <> ''
        GROUP BY TRIM(business_type)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
    queryGroupedSuggestions(
      orderDb,
      `
        SELECT
          TRIM(origin) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM orders
        WHERE origin IS NOT NULL AND TRIM(origin) <> ''
        GROUP BY TRIM(origin)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
    queryGroupedSuggestions(
      orderDb,
      `
        SELECT
          TRIM(destination) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM orders
        WHERE destination IS NOT NULL AND TRIM(destination) <> ''
        GROUP BY TRIM(destination)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
    queryGroupedSuggestions(
      orderDb,
      `
        SELECT
          TRIM(trade_term) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM orders
        WHERE trade_term IS NOT NULL AND TRIM(trade_term) <> ''
        GROUP BY TRIM(trade_term)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
    queryGroupedSuggestions(
      orderDb,
      `
        SELECT
          TRIM(product_name) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM orders
        WHERE product_name IS NOT NULL AND TRIM(product_name) <> ''
        GROUP BY TRIM(product_name)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
    queryGroupedSuggestions(
      orderDb,
      `
        SELECT
          TRIM(name_cn) AS value,
          COUNT(*) AS frequency,
          MAX(updated_at) AS last_used_at
        FROM products
        WHERE name_cn IS NOT NULL AND TRIM(name_cn) <> ''
        GROUP BY TRIM(name_cn)
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT ${DEFAULT_LIMIT}
      `
    ),
  ]);

  const companyNameMap = new Map();
  mergeSuggestionRows(companyNameMap, orderCompanies, "orders");
  mergeSuggestionRows(companyNameMap, profileCompanies, "user_profiles");

  const productNameMap = new Map();
  mergeSuggestionRows(productNameMap, orderProductNames, "orders");
  mergeSuggestionRows(productNameMap, productCatalogNames, "products");

  return {
    scope: SCOPE_ORDER_FORM,
    generated_at: new Date().toISOString(),
    fields: {
      company_name: sortSuggestions(Array.from(companyNameMap.values())),
      business_type: sortSuggestions(orderBusinessTypes),
      origin: sortSuggestions(orderOrigins),
      destination: sortSuggestions(orderDestinations),
      trade_term: sortSuggestions(orderTradeTerms),
      product_name: sortSuggestions(Array.from(productNameMap.values())),
    },
  };
}

async function buildScopePayload(scope, orderDb, userDb) {
  if (scope === SCOPE_ORDER_FORM) {
    return buildOrderFormSuggestions(orderDb, userDb);
  }

  const error = new Error(`Unsupported input memory scope: ${scope}`);
  error.statusCode = 400;
  throw error;
}

async function getCachedScopePayload(scope, orderDb, userDb) {
  const cached = scopeCache.get(scope);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const payload = await buildScopePayload(scope, orderDb, userDb);
  scopeCache.set(scope, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return payload;
}

module.exports = (orderDb, userDb = null) => {
  router.get("/suggestions", async (req, res) => {
    const scope = normalizeSuggestionValue(req.query.scope || SCOPE_ORDER_FORM);

    try {
      const payload = await getCachedScopePayload(scope || SCOPE_ORDER_FORM, orderDb, userDb);
      res.json(payload);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  return router;
};
