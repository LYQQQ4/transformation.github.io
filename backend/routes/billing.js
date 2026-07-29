const express = require("express");

const router = express.Router();

const BILLING_FEE_CATEGORIES = [
  "提货运输费",
  "出口报关操作费",
  "空运单价/kg",
  "国际运费",
  "THC操作费",
  "清关费",
  "送货运输费",
  "其他杂费",
  "增值服务费",
  "代垫费",
  "费用小计",
  "含税价",
];

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

function createEmptyFeeItem(category) {
  return {
    category,
    fee_detail: "",
    amount: "",
    tax_rate: "",
    supplier: "",
    exchange_rate: "",
    remark: "",
    billing_period: "",
  };
}

function normalizeFeeItem(item = {}, category) {
  return {
    category,
    fee_detail: sanitizeString(item.fee_detail),
    amount: sanitizeString(item.amount),
    tax_rate: sanitizeString(item.tax_rate),
    supplier: sanitizeString(item.supplier),
    exchange_rate: sanitizeString(item.exchange_rate),
    remark: sanitizeString(item.remark),
    billing_period: sanitizeString(item.billing_period),
  };
}

function normalizeFeeItems(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  const itemMap = new Map(
    sourceItems.map((item) => [sanitizeString(item.category || item.fee_category), item])
  );

  return BILLING_FEE_CATEGORIES.map((category) =>
    normalizeFeeItem(itemMap.get(category) || createEmptyFeeItem(category), category)
  );
}

function parseStoredFeeItems(value) {
  if (!value) {
    return normalizeFeeItems([]);
  }

  try {
    return normalizeFeeItems(JSON.parse(value));
  } catch (error) {
    return normalizeFeeItems([]);
  }
}

function stringifyFeeItems(items) {
  return JSON.stringify(normalizeFeeItems(items));
}

async function ensureBillingSchema(db) {
  if (!billingSchemaReadyPromise) {
    billingSchemaReadyPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS billing_info (
          id INT AUTO_INCREMENT PRIMARY KEY,
          serial_number VARCHAR(64) NOT NULL,
          billing_completed_time DATE DEFAULT NULL,
          cost_items LONGTEXT DEFAULT NULL,
          billing_items LONGTEXT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_billing_serial_number (serial_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
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
      pkg.pieces_total,
      pkg.weight_total,
      pkg.volume_total,
      pkg.charge_weight_total AS charge_weight,
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

  return {
    ...row,
    cost_items: parseStoredFeeItems(row.cost_items),
    billing_items: parseStoredFeeItems(row.billing_items),
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
        records: rows.map((row) => ({
          ...row,
          cost_items: undefined,
          billing_items: undefined,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
        "SELECT billing_completed_time, cost_items, billing_items FROM billing_info WHERE serial_number = ? LIMIT 1",
        [serialNumber]
      );

      const existing = existingRows[0] || {};
      const billingCompletedTime = req.body.billing_completed_time !== undefined
        ? normalizeOptionalDate(req.body.billing_completed_time)
        : (existing.billing_completed_time || null);
      const costItems = req.body.cost_items !== undefined
        ? stringifyFeeItems(req.body.cost_items)
        : (existing.cost_items || stringifyFeeItems([]));
      const billingItems = req.body.billing_items !== undefined
        ? stringifyFeeItems(req.body.billing_items)
        : (existing.billing_items || stringifyFeeItems([]));

      await db.execute(
        `INSERT INTO billing_info (serial_number, billing_completed_time, cost_items, billing_items)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           billing_completed_time = VALUES(billing_completed_time),
           cost_items = VALUES(cost_items),
           billing_items = VALUES(billing_items)`,
        [serialNumber, billingCompletedTime, costItems, billingItems]
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
