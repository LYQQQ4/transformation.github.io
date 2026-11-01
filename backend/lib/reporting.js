const orderSummaryFields = require("../../frontend/order_summary_fields");

function normalizeTextValue(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function isFilledValue(value) {
  return normalizeTextValue(value) !== "";
}

function parseStoredFeeItems(value) {
  return orderSummaryFields.parseFeeItems(value);
}

let billingInfoSchemaReadyPromise = null;
let reportSchemaReadyPromise = null;

async function ensureBillingInfoSchema(db) {
  if (!billingInfoSchemaReadyPromise) {
    billingInfoSchemaReadyPromise = (async () => {
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

      const [completedTimeColumns] = await db.execute(
        `SELECT COUNT(*) AS count
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'billing_info'
           AND COLUMN_NAME = 'billing_completed_time'`
      );
      if (!completedTimeColumns[0] || Number(completedTimeColumns[0].count) === 0) {
        await db.execute(
          "ALTER TABLE billing_info ADD COLUMN billing_completed_time DATE DEFAULT NULL"
        );
      }
    })().catch((error) => {
      billingInfoSchemaReadyPromise = null;
      throw error;
    });
  }

  return billingInfoSchemaReadyPromise;
}

async function ensureReportSchema(db) {
  if (!reportSchemaReadyPromise) {
    reportSchemaReadyPromise = (async () => {
      const [tables] = await db.execute("SHOW TABLES LIKE 'package'");
      if (tables.length === 0) {
        return;
      }

      for (const column of [
        { name: "remark1", sql: "ALTER TABLE `package` ADD COLUMN remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1'" },
        { name: "remark2", sql: "ALTER TABLE `package` ADD COLUMN remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2'" },
      ]) {
        const [columns] = await db.execute(
          `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'package'
             AND COLUMN_NAME = ?`,
          [column.name]
        );
        if (columns.length === 0) {
          await db.execute(column.sql);
        }
      }
    })().catch((error) => {
      reportSchemaReadyPromise = null;
      throw error;
    });
  }

  return reportSchemaReadyPromise;
}

function deriveBillingPeriod(row = {}) {
  return orderSummaryFields.deriveBillingPeriod(row);
}

function enrichOrderBillingFields(row = {}) {
  return orderSummaryFields.enrichOrderSummaryFields({
    ...row,
    billing_period: deriveBillingPeriod(row),
  });
}

function buildFilledStatusSql(columnName, filledStatus) {
  const normalizedExpression = `NULLIF(TRIM(CAST(${columnName} AS CHAR)), '')`;

  if (filledStatus === "filled") {
    return `${normalizedExpression} IS NOT NULL`;
  }

  if (filledStatus === "unfilled") {
    return `${normalizedExpression} IS NULL`;
  }

  return "";
}

const REPORT_EMPTY_VALUE_TEXT = orderSummaryFields.ORDER_SUMMARY_EMPTY_VALUE_TEXT;
const TOTAL_REPORT_FIELD_DEFINITIONS = orderSummaryFields.TOTAL_REPORT_FIELD_DEFINITIONS;

function formatTotalReportValue(columnKey, value, options = {}) {
  return orderSummaryFields.formatOrderSummaryValue(columnKey, value, {
    emptyValueText: normalizeTextValue(options.emptyValueText) || REPORT_EMPTY_VALUE_TEXT,
  });
}

function combineTrackingRemarks(row = {}, remarkNumber) {
  const sourceDefinitions = [
    ["pickup_remark", "提货备注"],
    ["transfer_remark", "送货备注"],
    ["customs_remark", "报关备注"],
  ];
  const values = [];
  const seen = new Set();

  sourceDefinitions.forEach(([prefix, label]) => {
    const value = normalizeTextValue(row[`${prefix}${remarkNumber}_source`]);
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    values.push({ label, value });
  });

  if (values.length === 1) {
    return values[0].value;
  }

  return values.map(({ label, value }) => `${label}：${value}`).join("\n");
}

function buildTotalReportSummaryRows(rows = [], options = {}) {
  const normalizedRows = rows.map((row) => ({
    ...enrichOrderBillingFields(row),
    remark1: normalizeTextValue(row.order_remark1 ?? row.remark1) || combineTrackingRemarks(row, 1),
    remark2: normalizeTextValue(row.order_remark2 ?? row.remark2) || combineTrackingRemarks(row, 2),
  }));
  const emptyValueText = normalizeTextValue(options.emptyValueText) || REPORT_EMPTY_VALUE_TEXT;

  const rawRows = normalizedRows.map((row) => {
    const summary = {};
    TOTAL_REPORT_FIELD_DEFINITIONS.forEach((field) => {
      const value = field.getValue(row);
      summary[field.key] = value ?? "";
    });
    return summary;
  });

  const columns = TOTAL_REPORT_FIELD_DEFINITIONS
    .map((field) => ({
      key: field.key,
      label: field.label,
      section: field.section || "",
      output_key: field.outputKey || field.key,
    }));

  const formattedRows = rawRows.map((row) => {
    const formattedRow = {};
    columns.forEach((column) => {
      formattedRow[column.key] = formatTotalReportValue(column.key, row[column.key], { emptyValueText });
    });
    return formattedRow;
  });

  return { columns, rows: formattedRows, emptyValueText };
}

module.exports = {
  combineTrackingRemarks,
  REPORT_EMPTY_VALUE_TEXT,
  TOTAL_REPORT_FIELD_DEFINITIONS,
  buildFilledStatusSql,
  buildTotalReportSummaryRows,
  deriveBillingPeriod,
  ensureBillingInfoSchema,
  ensureReportSchema,
  enrichOrderBillingFields,
  formatTotalReportValue,
  isFilledValue,
  normalizeTextValue,
  parseStoredFeeItems,
};
