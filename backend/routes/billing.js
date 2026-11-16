const express = require("express");
const billingTemplates = require("../../frontend/billing_templates");
const billingFormula = require("../../frontend/billing_formula");
const orderSummaryFields = require("../../frontend/order_summary_fields");
const { requireUserAccess } = require("../lib/request_auth");
const { buildFilledStatusSql } = require("../lib/reporting");
const multer = require("multer");
const path = require("path");
const { createHash } = require("crypto");
const excel = require("../lib/billing_excel");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: excel.MAX_BYTES, files: 1, fields: 0, parts: 2 },
  fileFilter(req, file, callback) {
    if (path.extname(file.originalname).toLowerCase() !== ".xlsx") {
      return callback(Object.assign(new Error("仅支持 .xlsx 文件"), { statusCode: 400 }));
    }
    callback(null, true);
  },
}).single("file");

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
      o.sender_company,
      o.receiver_company,
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
      b.id AS billing_id,
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

module.exports = (db, userDb = null) => {
  const router = express.Router();
  let activeImports = 0;
  // The current application grants every logged-in user access to every order.
  // Keep list/export/import on the same server-side access policy.
  const requireBillingAccess = (req) => requireUserAccess(userDb, req, "账单批量处理");
  const sendError = (res, error) => res.status(error.statusCode || 500).json({
    success: false,
    error: error.statusCode && error.statusCode < 500 ? error.message : "账单处理失败，未提交任何更新，请重试",
  });
  const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

  router.post("/export", async (req, res) => {
    try {
      await requireBillingAccess(req);
      const serials = req.body.serial_numbers;
      if (!Array.isArray(serials) || !serials.length || serials.length > excel.MAX_ROWS ||
          serials.some((serial) => typeof serial !== "string" || !serial.trim() || serial.length > 64) ||
          new Set(serials).size !== serials.length) {
        throw badRequest(`请选择 1 至 ${excel.MAX_ROWS} 个不重复的流水号`);
      }
      await ensureBillingSchema(db);
      const [rows] = await db.execute(buildBillingSummarySelect(
        `WHERE o.serial_number IN (${serials.map(() => "?").join(",")})`
      ), serials);
      const bySerial = new Map(rows.map((row) => [row.serial_number, row]));
      if (serials.some((serial) => !bySerial.has(serial))) throw badRequest("存在不存在或无权限的流水号，请刷新账单列表");
      const buffer = excel.exportWorkbook(serials.map((serial) => bySerial.get(serial)));
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="billing_${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(`账单批量导入模板_${date}.xlsx`)}`);
      res.send(buffer);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/import", async (req, res) => {
    let operator;
    try {
      operator = await requireBillingAccess(req);
    } catch (error) {
      return sendError(res, error);
    }
    if (activeImports >= 2) {
      return res.status(429).json({ success: false, error: "当前导入任务较多，请稍后重试" });
    }
    activeImports += 1;
    upload(req, res, async (uploadError) => {
      let connection;
      let started = false;
      try {
        if (uploadError) throw badRequest(uploadError.code === "LIMIT_FILE_SIZE" ? "文件不能超过 5MB" : uploadError.message);
        if (!req.file) throw badRequest("请选择 Excel 文件");
        const { rows, snapshots } = await excel.parseUpload(req.file.buffer);
        await ensureBillingSchema(db);
        await excel.ensureImportAuditSchema(db);
        connection = await db.getConnection();
        await connection.beginTransaction();
        started = true;
        const serials = [...new Set(rows.map((row) => row.serial).filter((serial) => serial && serial.length <= 64))].sort();
        // Lock the parent rows in stable order, including bills absent at export time.
        if (serials.length) {
          await connection.execute(
            `SELECT serial_number FROM orders WHERE serial_number IN (${serials.map(() => "?").join(",")}) ORDER BY serial_number FOR UPDATE`,
            serials
          );
          await connection.execute(
            `SELECT serial_number FROM billing_info WHERE serial_number IN (${serials.map(() => "?").join(",")}) ORDER BY serial_number FOR UPDATE`,
            serials
          );
        }
        const [records] = serials.length ? await connection.execute(buildBillingSummarySelect(
          `WHERE o.serial_number IN (${serials.map(() => "?").join(",")})`
        ), serials) : [[]];
        const bySerial = new Map(records.map((record) => [record.serial_number, record]));
        const counts = new Map();
        rows.forEach((row) => counts.set(row.serial, (counts.get(row.serial) || 0) + 1));
        const summary = { total: rows.length, updated: 0, failed: 0, skipped: 0, duplicated: 0 };
        const errors = [];
        const warnings = [];
        const results = [];
        const notFound = new Set();
        const addErrors = (row, issues, status = "failed") => {
          issues.forEach((issue) => errors.push({ row: row.row, trackingNumber: row.serial, ...issue }));
          results.push({ row: row.row, trackingNumber: row.serial, status });
          summary[status === "duplicated" ? "skipped" : "failed"] += 1;
          if (status === "duplicated") summary.duplicated += 1;
        };
        for (const row of rows) {
          if (!row.serial || row.serial.length > 64) {
            addErrors(row, [{ field: "流水号", message: "流水号不能为空且不能超过 64 字符" }]);
            continue;
          }
          if (row.numericSerial) {
            addErrors(row, [{ field: "流水号", message: "流水号必须使用文本单元格，避免前导零或长编号丢失" }]);
            continue;
          }
          if (counts.get(row.serial) > 1) {
            addErrors(row, [{ field: "流水号", message: "Excel 中流水号重复，所有重复行均未更新" }], "duplicated");
            continue;
          }
          const record = bySerial.get(row.serial);
          if (!record) {
            notFound.add(row.serial);
            addErrors(row, [{ field: "流水号", message: "流水号不存在" }]);
            continue;
          }
          const prepared = excel.prepareUpdate(row, record, Object.hasOwn(snapshots, row.serial) ? snapshots[row.serial] : undefined);
          prepared.warnings.forEach((warning) => warnings.push({ row: row.row, trackingNumber: row.serial, ...warning }));
          if (prepared.errors.length) {
            addErrors(row, prepared.errors);
            continue;
          }
          if (!Object.keys(prepared.changes).length) {
            summary.skipped += 1;
            results.push({ row: row.row, trackingNumber: row.serial, status: "skipped" });
            continue;
          }
          // Only persist changed sides; all business fields remain database-owned.
          const fields = [];
          const params = [];
          if (prepared.changes[13] !== undefined) {
            fields.push("cost_items = ?");
            params.push(JSON.stringify(prepared.cost));
          }
          if (prepared.changes[14] !== undefined || prepared.changes[15] !== undefined) {
            fields.push("billing_items = ?");
            params.push(JSON.stringify(prepared.sales));
          }
          if (!record.billing_id) {
            const templateKey = resolveBillingTemplateContext(record).templateContext.key;
            await connection.execute(
              "INSERT INTO billing_info (serial_number, billing_template_key, cost_items, billing_items) VALUES (?, ?, ?, ?)",
              [row.serial, templateKey === billingTemplates.LEGACY_BILLING_TEMPLATE_KEY ? null : templateKey,
                prepared.changes[13] !== undefined ? JSON.stringify(prepared.cost) : null,
                prepared.changes[14] !== undefined || prepared.changes[15] !== undefined ? JSON.stringify(prepared.sales) : null]
            );
          } else {
            await connection.execute(`UPDATE billing_info SET ${fields.join(", ")} WHERE serial_number = ?`, [...params, row.serial]);
          }
          summary.updated += 1;
          results.push({ row: row.row, trackingNumber: row.serial, status: "updated" });
        }
        const report = errors.length ? excel.errorReport(rows, errors) : null;
        await connection.execute(
          "INSERT INTO billing_import_log (operator_id, file_name, file_sha256, file_size, summary_json) VALUES (?, ?, ?, ?, ?)",
          [String(operator.id), path.basename(req.file.originalname).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255),
            createHash("sha256").update(req.file.buffer).digest("hex"), req.file.size, JSON.stringify(summary)]
        );
        await connection.commit();
        started = false;
        res.json({
          success: true, mode: "valid_rows_atomic", summary, errors, warnings, results,
          notFoundSerialNumbers: [...notFound], unauthorizedSerialNumbers: [],
          errorReport: report ? { filename: "账单导入错误报告.xlsx", base64: report } : null,
        });
      } catch (error) {
        if (connection && started) {
          try {
            await connection.rollback();
          } catch {
            // A broken connection cannot be reused after a failed rollback.
            connection.destroy();
            connection = null;
          }
        }
        sendError(res, error);
      } finally {
        activeImports -= 1;
        if (connection) connection.release();
        // Memory uploads are never written to a public or executable directory.
        if (req.file) req.file.buffer = null;
      }
    });
  });

  router.get("/", async (req, res) => {
    try {
      if (userDb) await requireBillingAccess(req);
      await ensureBillingSchema(db);
      const conditions = ["o.serial_number IS NOT NULL"];
      const params = [];
      const companyName = String(req.query.company_name || "").trim();
      if (companyName) {
        conditions.push("o.company_name LIKE ?");
        params.push(`%${companyName}%`);
      }

      const appendFilledStatusCondition = (queryKey, expression) => {
        const status = String(req.query[queryKey] || "all").trim();
        const condition = buildFilledStatusSql(expression, status);
        if (condition) {
          conditions.push(condition);
        }
      };

      appendFilledStatusCondition("billing_completed_time_filled_status", "b.billing_completed_time");
      appendFilledStatusCondition("cost_filled_status", "b.cost_items");
      appendFilledStatusCondition("sales_filled_status", "b.billing_items");
      appendFilledStatusCondition(
        "billing_period_filled_status",
        "COALESCE(NULLIF(TRIM(CAST(b.billing_items AS CHAR)), ''), NULLIF(TRIM(CAST(t.billing_period AS CHAR)), ''))"
      );

      const [rows] = await db.execute(
        `${buildBillingSummarySelect(`WHERE ${conditions.join(" AND ")}`)} ORDER BY o.id DESC`,
        params
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
      res.status(err.statusCode || (isFormulaValidationError ? 400 : 500)).json({ error: err.message });
    }
  });

  router.get("/serial/:serial_number", async (req, res) => {
    try {
      if (userDb) await requireBillingAccess(req);
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
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.put("/batch-date", async (req, res) => {
    try {
      await requireUserAccess(userDb, req, "账单板块批量日期修改");
      // Keep the retired endpoint explicit for clients using the old batch API.
      return res.status(400).json({ error: "field is not allowed for this module" });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.put("/serial/:serial_number", async (req, res) => {
    try {
      if (userDb) await requireBillingAccess(req);
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
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  return router;
};
