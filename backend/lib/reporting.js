function normalizeTextValue(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return String(value).trim();
}

function isFilledValue(value) {
  return normalizeTextValue(value) !== "";
}

function isEmptyReportValue(value) {
  return normalizeTextValue(value) === "";
}

function parseStoredFeeItems(value) {
  if (!isFilledValue(value)) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

let billingInfoSchemaReadyPromise = null;

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
    })().catch((error) => {
      billingInfoSchemaReadyPromise = null;
      throw error;
    });
  }

  return billingInfoSchemaReadyPromise;
}

function deriveBillingPeriod(row = {}) {
  const directBillingPeriod = normalizeTextValue(row.billing_period_raw || row.billing_period);
  if (directBillingPeriod) {
    return directBillingPeriod;
  }

  const periods = [];
  const seen = new Set();

  parseStoredFeeItems(row.billing_items_raw || row.billing_items).forEach((item) => {
    const period = normalizeTextValue(item?.billing_period);
    if (!period || seen.has(period)) {
      return;
    }

    seen.add(period);
    periods.push(period);
  });

  return periods.join(" / ");
}

function enrichOrderBillingFields(row = {}) {
  return {
    ...row,
    billing_period: deriveBillingPeriod(row),
  };
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

const REPORT_EMPTY_VALUE_TEXT = "\u8be5\u9879\u672a\u586b";

const TOTAL_REPORT_DATE_COLUMN_KEYS = new Set([
  "receive_date",
  "pickup_date",
  "arrival_time",
  "customs_start_time",
  "tax_payment_time",
  "release_time",
  "arrival_port_time",
  "clearance_time",
  "delivery_time",
  "complete_docs_send_time",
  "billing_completed_time",
]);

const TOTAL_REPORT_FIELD_DEFINITIONS = [
  {
    key: "serial_number",
    outputKey: "serial_number",
    section: "base",
    label: "\u6d41\u6c34\u53f7",
    getValue: (row) => row.serial_number,
  },
  {
    key: "company_name",
    outputKey: "company_name",
    section: "base",
    label: "\u516c\u53f8\u540d\u79f0",
    getValue: (row) => row.company_name,
  },
  {
    key: "orderer",
    outputKey: "orderer",
    section: "base",
    label: "\u6307\u4ee4\u4eba",
    getValue: (row) => row.orderer,
  },
  {
    key: "business_type",
    outputKey: "business_type",
    section: "base",
    label: "\u4e1a\u52a1\u7c7b\u578b",
    getValue: (row) => row.business_type,
  },
  {
    key: "sender_id",
    outputKey: "sender_id",
    section: "base",
    label: "\u53d1\u4ef6\u4ebaID",
    getValue: (row) => row.sender_id,
  },
  {
    key: "customer_id",
    outputKey: "customer_id",
    section: "base",
    label: "\u5ba2\u6237ID",
    getValue: (row) => row.customer_id,
  },
  {
    key: "receive_date",
    outputKey: "receive_date",
    section: "base",
    label: "\u63a5\u6536\u6307\u4ee4\u65e5\u671f",
    getValue: (row) => row.receive_date,
  },
  {
    key: "origin",
    outputKey: "origin",
    section: "base",
    label: "\u8d77\u59cb\u5730",
    getValue: (row) => row.order_origin || row.origin,
  },
  {
    key: "destination",
    outputKey: "destination",
    section: "base",
    label: "\u76ee\u7684\u5730",
    getValue: (row) => row.order_destination || row.destination,
  },
  {
    key: "trade_term",
    outputKey: "trade_term",
    section: "base",
    label: "\u8d38\u6613\u672f\u8bed",
    getValue: (row) => row.trade_term,
  },
  {
    key: "product_name",
    outputKey: "product_name",
    section: "base",
    label: "\u8d27\u7269\u54c1\u540d",
    getValue: (row) => row.order_product_name || row.product_name,
  },
  {
    key: "transport_mode",
    outputKey: "transport_mode",
    section: "tracking",
    label: "\u8fd0\u8f93\u65b9\u5f0f",
    getValue: (row) => row.transport_mode,
  },
  {
    key: "tracking_number",
    outputKey: "tracking_number",
    section: "tracking",
    label: "\u8fd0\u5355\u53f7",
    getValue: (row) => row.tracking_number,
  },
  {
    key: "pickup_date",
    outputKey: "pickup_date",
    section: "tracking",
    label: "\u63d0\u8d27\u65f6\u95f4",
    getValue: (row) => row.pickup_date,
  },
  {
    key: "arrival_time",
    outputKey: "arrival_time",
    section: "tracking",
    label: "\u5230\u8d27\u65f6\u95f4",
    getValue: (row) => row.arrival_time,
  },
  {
    key: "customs_port",
    outputKey: "customs_port",
    section: "customs",
    label: "\u62a5\u5173\u53e3\u5cb8",
    getValue: (row) => row.customs_port,
  },
  {
    key: "customs_title",
    outputKey: "customs_title",
    section: "customs",
    label: "\u62a5\u5173\u54c1\u540d",
    getValue: (row) => row.customs_title,
  },
  {
    key: "customs_start_time",
    outputKey: "customs_start_time",
    section: "customs",
    label: "\u5f00\u59cb\u62a5\u5173\u65f6\u95f4",
    getValue: (row) => row.customs_start_time,
  },
  {
    key: "tax_payment_time",
    outputKey: "tax_payment_time",
    section: "customs",
    label: "\u4ed8\u7a0e\u65f6\u95f4",
    getValue: (row) => row.tax_payment_time,
  },
  {
    key: "release_time",
    outputKey: "release_time",
    section: "customs",
    label: "\u653e\u884c\u65f6\u95f4",
    getValue: (row) => row.release_time,
  },
  {
    key: "customs_declaration_number",
    outputKey: "customs_declaration_number",
    section: "customs",
    label: "\u62a5\u5173\u5355\u53f7",
    getValue: (row) => row.customs_declaration_number,
  },
  {
    key: "customs_supplier",
    outputKey: "customs_supplier",
    section: "customs",
    label: "\u62a5\u5173\u4f9b\u5e94\u5546",
    getValue: (row) => row.customs_supplier,
  },
  {
    key: "arrival_port_time",
    outputKey: "arrival_port_time",
    section: "delivery",
    label: "\u5230\u6e2f\u65f6\u95f4",
    getValue: (row) => row.arrival_port_time,
  },
  {
    key: "clearance_time",
    outputKey: "clearance_time",
    section: "delivery",
    label: "\u6e05\u5173\u65f6\u95f4",
    getValue: (row) => row.clearance_time,
  },
  {
    key: "delivery_time",
    outputKey: "delivery_time",
    section: "delivery",
    label: "\u9001\u8fbe\u65f6\u95f4",
    getValue: (row) => row.delivery_time,
  },
  {
    key: "complete_docs_send_time",
    outputKey: "complete_docs_send_time",
    section: "delivery",
    label: "\u5b8c\u6574\u5355\u636e\u56de\u590d\u65f6\u95f4",
    getValue: (row) => row.complete_docs_send_time,
  },
  {
    key: "billing_completed_time",
    outputKey: "billing_completed_time",
    section: "billing",
    label: "\u65b0\u589e\u8d26\u5355\u5b8c\u6210\u65f6\u95f4",
    getValue: (row) => row.billing_completed_time,
  },
  {
    key: "billing_period",
    outputKey: "billing_period",
    section: "billing",
    label: "\u8d26\u671f",
    getValue: (row) => row.billing_period,
  },
  {
    key: "pieces_total",
    outputKey: "pieces_total",
    section: "package",
    label: "\u4ef6\u6570",
    getValue: (row) => row.pieces_total,
  },
  {
    key: "weight_total",
    outputKey: "weight_total",
    section: "package",
    label: "\u91cd\u91cf",
    getValue: (row) => row.weight_total,
  },
  {
    key: "volume_total",
    outputKey: "volume_total",
    section: "package",
    label: "\u4f53\u79ef",
    getValue: (row) => row.volume_total,
  },
  {
    key: "charge_weight_total",
    outputKey: "charge_weight_total",
    section: "package",
    label: "\u8ba1\u8d39\u91cd\u91cf",
    getValue: (row) => row.charge_weight_total,
  },
];

function formatReportDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, "0")}/${String(value.getDate()).padStart(2, "0")}`;
  }

  const dateMatch = String(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (dateMatch) {
    return `${dateMatch[1]}/${String(dateMatch[2]).padStart(2, "0")}/${String(dateMatch[3]).padStart(2, "0")}`;
  }

  return normalizeTextValue(value);
}

function formatTotalReportValue(columnKey, value, options = {}) {
  const emptyValueText = normalizeTextValue(options.emptyValueText) || REPORT_EMPTY_VALUE_TEXT;

  if (isEmptyReportValue(value)) {
    return emptyValueText;
  }

  if (TOTAL_REPORT_DATE_COLUMN_KEYS.has(columnKey)) {
    return formatReportDateValue(value);
  }

  return normalizeTextValue(value);
}

function normalizeSelectedReportFieldKeys(selectedFieldKeys) {
  if (!Array.isArray(selectedFieldKeys)) {
    return null;
  }

  return selectedFieldKeys
    .map((fieldKey) => normalizeTextValue(fieldKey))
    .filter(Boolean);
}

function buildTotalReportSummaryRows(rows = [], options = {}) {
  const normalizedRows = rows.map((row) => enrichOrderBillingFields(row));
  const selectedFieldKeys = normalizeSelectedReportFieldKeys(options.selectedFieldKeys);
  const selectedFieldKeySet = selectedFieldKeys ? new Set(selectedFieldKeys) : null;
  const emptyValueText = normalizeTextValue(options.emptyValueText) || REPORT_EMPTY_VALUE_TEXT;
  const hasDataMap = new Map(TOTAL_REPORT_FIELD_DEFINITIONS.map((field) => [field.key, false]));

  const rawRows = normalizedRows.map((row) => {
    const summary = {};

    TOTAL_REPORT_FIELD_DEFINITIONS.forEach((field) => {
      const value = field.getValue(row);
      summary[field.key] = value ?? "";
      if (!isEmptyReportValue(value)) {
        hasDataMap.set(field.key, true);
      }
    });

    return summary;
  });

  const outputKeys = new Set();
  const columns = TOTAL_REPORT_FIELD_DEFINITIONS
    .filter((field) => {
      if (selectedFieldKeySet && !selectedFieldKeySet.has(field.key)) {
        return false;
      }

      if (!selectedFieldKeySet && field.key !== "serial_number" && !hasDataMap.get(field.key)) {
        return false;
      }

      const outputKey = field.outputKey || field.key;
      if (outputKeys.has(outputKey)) {
        return false;
      }

      outputKeys.add(outputKey);
      return true;
    })
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

  return {
    columns,
    rows: formattedRows,
    emptyValueText,
  };
}

module.exports = {
  REPORT_EMPTY_VALUE_TEXT,
  TOTAL_REPORT_FIELD_DEFINITIONS,
  buildFilledStatusSql,
  buildTotalReportSummaryRows,
  deriveBillingPeriod,
  ensureBillingInfoSchema,
  enrichOrderBillingFields,
  formatTotalReportValue,
  isFilledValue,
  normalizeSelectedReportFieldKeys,
  normalizeTextValue,
  parseStoredFeeItems,
};
