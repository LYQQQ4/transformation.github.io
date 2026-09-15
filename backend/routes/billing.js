const express = require("express");
const billingTemplates = require("../../frontend/billing_templates");
const billingFormula = require("../../frontend/billing_formula");
const orderSummaryFields = require("../../frontend/order_summary_fields");

const router = express.Router();

let billingSchemaReadyPromise = null;

function sanitizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  return String(value);
}

function sanitizeString(value) {
  return sanitizeNullableString(value) || "";
}

function normalizeSerialNumber(value) {
  return sanitizeString(value);
}

function normalizeOptionalDate(value) {
  const normalized = sanitizeNullableString(value);
  if (!normalized) {
    return null;
  }

  if (typeof normalized !== "string") {
    return null;
  }

  const trimmed = normalized.trim();
  const match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseStoredFeeItems(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeFeeItemsForTemplate(items, templateKey) {
  const normalizedItems = billingTemplates.normalizeBillingItems(items, templateKey, {
    preserveUnknown: templateKey === billingTemplates.LEGACY_BILLING_TEMPLATE_KEY,
  });

  return billingFormula.normalizeBillingItems(
    normalizedItems,
    templateKey,
    (nextItems, nextTemplateKey) =>
      billingTemplates.normalizeBillingItems(nextItems, nextTemplateKey, {
        preserveUnknown: nextTemplateKey === billingTemplates.LEGACY_BILLING_TEMPLATE_KEY,
      }),
    { strict: false }
  );
}

function sanitizeFeeItemsForPersistence(items, templateKey) {
  return billingFormula.normalizeBillingItems(
    items,
    templateKey,
    (nextItems, nextTemplateKey) =>
      billingTemplates.normalizeBillingItems(nextItems, nextTemplateKey, {
        preserveUnknown: nextTemplateKey === billingTemplates.LEGACY_BILLING_TEMPLATE_KEY,
      })
  );
}

function stringifyFeeItems(items, templateKey) {
  return JSON.stringify(sanitizeFeeItemsForPersistence(items, templateKey));
}

function resolveBillingTemplateContext(row = {}, options = {}) {
  const rawCostItems = parseStoredFeeItems(row.cost_items);
  const rawBillingItems = parseStoredFeeItems(row.billing_items);
  const storedTemplateKey = sanitizeString(row.billing_template_key);
  const templateContext = billingTemplates.resolveBillingTemplate(
    {
      ...row,
      cost_items: rawCostItems,
      billing_items: rawBillingItems,
    },
    { preferredTemplateKey: options.preferredTemplateKey || storedTemplateKey }
  );

  return {
    rawCostItems,
    rawBillingItems,
    templateContext,
  };
}

async function ensureBillingSchema(db) {
  if (!billingSchemaReadyPromise) {
    billingSchemaReadyPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS billing_info (
          id INT AUTO_INCREMENT PRIMARY KEY,
          serial_number VARCHAR(64) NOT NULL,
          billing_template_key VARCHAR(32) DEFAULT NULL,
          billing_completed_time DATE DEFAULT NULL,
          cost_items LONGTEXT DEFAULT NULL,
          billing_items LONGTEXT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_billing_serial_number (serial_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      const [templateKeyColumns] = await db.execute(
        `SELECT COUNT(*) AS count
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'billing_info'
           AND COLUMN_NAME = 'billing_template_key'`
      );
      if (!templateKeyColumns[0] || Number(templateKeyColumns[0].count) === 0) {
        await db.execute(
          "ALTER TABLE billing_info ADD COLUMN billing_template_key VARCHAR(32) DEFAULT NULL"
        );
      }
    })().catch((error) => {
      billingSchemaReadyPromise = null;
      throw error;
    });
  }

  return billingSchemaReadyPromise;
}

function buildBillingSummarySelect(whereClause = "") {
  return `
    SELECT
      o.serial_number,
      o.company_name,
      o.orderer,
      o.business_type,
      o.sender_id,
      o.customer_id,
      o.receive_date,
      o.origin,
      o.destination,
      o.trade_term,
      o.product_name,
      COALESCE(pt.transport_mode, t.transport_mode) AS transport_mode,
      t.tracking_number AS tracking_number,
      t.billing_period AS billing_period_raw,
      pkg.pieces_total,
      pkg.weight_total,
      pkg.volume_total,
      pkg.charge_weight_total AS charge_weight,
      b.billing_template_key,
      b.billing_completed_time,
      b.cost_items,
      b.billing_items
    FROM orders o
    LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = o.serial_number
    LEFT JOIN transfer t ON t.serial_number = o.serial_number
    LEFT JOIN (
      SELECT
        serial_number,
        SUM(COALESCE(pieces, 0)) AS pieces_total,
        ROUND(SUM(COALESCE(single_weight, 0) * (CASE WHEN pieces IS NULL OR pieces <= 0 THEN 1 ELSE pieces END)), 2) AS weight_total,
        ROUND(SUM(COALESCE(volume, 0) * (CASE WHEN pieces IS NULL OR pieces <= 0 THEN 1 ELSE pieces END)), 4) AS volume_total,
        MAX(charge_weight) AS charge_weight_total
      FROM \`package\`
      GROUP BY serial_number
    ) pkg ON pkg.serial_number = o.serial_number
    LEFT JOIN billing_info b ON b.serial_number = o.serial_number
    ${whereClause}
  `;
}

function normalizeBillingRecord(row) {
  if (!row) {
    return null;
  }

  const { rawCostItems, rawBillingItems, templateContext } = resolveBillingTemplateContext(row);
  const templateKey = templateContext.key;

  return {
    ...row,
    ...orderSummaryFields.enrichOrderSummaryFields(row),
    billing_template_key: templateKey,
    billing_template_label: templateContext.template.label,
    billing_template_title: templateContext.template.title,
    billing_amount_label: templateContext.template.amountLabel,
    billing_template_source: templateContext.source,
    cost_items: normalizeFeeItemsForTemplate(rawCostItems, templateKey),
    billing_items: normalizeFeeItemsForTemplate(rawBillingItems, templateKey),
  };
}

module.exports = (db) => {
  router.get("/", async (req, res) => {
    try {
      await ensureBillingSchema(db);
      const [rows] = await db.execute(
        `${buildBillingSummarySelect("WHERE o.serial_number IS NOT NULL")} ORDER BY o.id DESC`
      );
      res.json({
        records: rows.map((row) => {
          const normalized = normalizeBillingRecord(row);
          return {
            ...normalized,
            cost_items: undefined,
            billing_items: undefined,
          };
        }),
      });
    } catch (err) {
      const isFormulaValidationError = Boolean(err?.fieldKey) || /^(amount|tax_rate|exchange_rate):/u.test(String(err?.message || ""));
      res.status(isFormulaValidationError ? 400 : 500).json({ error: err.message });
    }
  });

  router.get("/serial/:serial_number", async (req, res) => {
    try {
      await ensureBillingSchema(db);
      const serialNumber = normalizeSerialNumber(req.params.serial_number);
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const [rows] = await db.execute(
        buildBillingSummarySelect("WHERE o.serial_number = ?"),
        [serialNumber]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Billing record not found" });
      }

      res.json({ record: normalizeBillingRecord(rows[0]) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/serial/:serial_number", async (req, res) => {
    try {
      await ensureBillingSchema(db);
      const serialNumber = normalizeSerialNumber(req.params.serial_number);
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const [orders] = await db.execute(
        "SELECT serial_number FROM orders WHERE serial_number = ? LIMIT 1",
        [serialNumber]
      );
      if (orders.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const [existingRows] = await db.execute(
        "SELECT billing_template_key, billing_completed_time, cost_items, billing_items FROM billing_info WHERE serial_number = ? LIMIT 1",
        [serialNumber]
      );
      const [summaryRows] = await db.execute(
        buildBillingSummarySelect("WHERE o.serial_number = ?"),
        [serialNumber]
      );

      const existing = existingRows[0] || {};
      const currentSummary = summaryRows[0] || {};
      const requestedTemplateKey = sanitizeString(req.body.billing_template_key || existing.billing_template_key);
      const templateContext = billingTemplates.resolveBillingTemplate(
        {
          ...currentSummary,
          cost_items: req.body.cost_items !== undefined ? req.body.cost_items : parseStoredFeeItems(existing.cost_items),
          billing_items: req.body.billing_items !== undefined ? req.body.billing_items : parseStoredFeeItems(existing.billing_items),
        },
        req.body.billing_template_key !== undefined
          ? { forceTemplateKey: requestedTemplateKey }
          : { preferredTemplateKey: requestedTemplateKey }
      );
      const templateKey = templateContext.key;
      const billingCompletedTime = req.body.billing_completed_time !== undefined
        ? normalizeOptionalDate(req.body.billing_completed_time)
        : (existing.billing_completed_time || null);
      const costItems = req.body.cost_items !== undefined
        ? stringifyFeeItems(req.body.cost_items, templateKey)
        : (existing.cost_items || stringifyFeeItems([], templateKey));
      const billingItems = req.body.billing_items !== undefined
        ? stringifyFeeItems(req.body.billing_items, templateKey)
        : (existing.billing_items || stringifyFeeItems([], templateKey));
      const billingTemplateKey = templateKey === billingTemplates.LEGACY_BILLING_TEMPLATE_KEY
        ? null
        : templateKey;

      await db.execute(
        `INSERT INTO billing_info (serial_number, billing_template_key, billing_completed_time, cost_items, billing_items)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           billing_template_key = VALUES(billing_template_key),
           billing_completed_time = VALUES(billing_completed_time),
           cost_items = VALUES(cost_items),
           billing_items = VALUES(billing_items)`,
        [serialNumber, billingTemplateKey, billingCompletedTime, costItems, billingItems]
      );

      const [rows] = await db.execute(
        buildBillingSummarySelect("WHERE o.serial_number = ?"),
        [serialNumber]
      );

      res.json({
        message: "Billing record updated successfully",
        record: normalizeBillingRecord(rows[0]),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
