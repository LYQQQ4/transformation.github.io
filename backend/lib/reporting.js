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

const TOTAL_REPORT_FIELD_DEFINITIONS = [
  { key: "serial_number", label: "流水号", getValue: (row) => row.serial_number },
  { key: "company_name", label: "公司名称", getValue: (row) => row.company_name },
  { key: "orderer", label: "指令人", getValue: (row) => row.orderer },
  { key: "business_type", label: "业务类型", getValue: (row) => row.business_type },
  { key: "sender_id", label: "发件人ID", getValue: (row) => row.sender_id },
  { key: "customer_id", label: "客户ID", getValue: (row) => row.customer_id },
  { key: "receive_date", label: "接收指令日期", getValue: (row) => row.receive_date },
  { key: "origin", label: "起始地", getValue: (row) => row.order_origin || row.origin },
  { key: "destination", label: "目的地", getValue: (row) => row.order_destination || row.destination },
  { key: "trade_term", label: "贸易术语", getValue: (row) => row.trade_term },
  { key: "product_name", label: "货物品名", getValue: (row) => row.order_product_name || row.product_name },
  { key: "transport_mode", label: "运输方式", getValue: (row) => row.transport_mode },
  { key: "tracking_number", label: "运单号", getValue: (row) => row.tracking_number },
  { key: "pickup_date", label: "提货时间", getValue: (row) => row.pickup_date },
  { key: "arrival_time", label: "到货时间", getValue: (row) => row.arrival_time },
  { key: "customs_port", label: "报关口岸", getValue: (row) => row.customs_port },
  { key: "customs_title", label: "报关品名", getValue: (row) => row.customs_title },
  { key: "customs_start_time", label: "开始报关时间", getValue: (row) => row.customs_start_time },
  { key: "tax_payment_time", label: "付税时间", getValue: (row) => row.tax_payment_time },
  { key: "release_time", label: "放行时间", getValue: (row) => row.release_time },
  { key: "customs_declaration_number", label: "报关单号", getValue: (row) => row.customs_declaration_number },
  { key: "customs_supplier", label: "报关供应商", getValue: (row) => row.customs_supplier },
  { key: "arrival_port_time", label: "到港时间", getValue: (row) => row.arrival_port_time },
  { key: "clearance_time", label: "清关时间", getValue: (row) => row.clearance_time },
  { key: "delivery_time", label: "送达时间", getValue: (row) => row.delivery_time },
  { key: "complete_docs_send_time", label: "完整单据回复时间", getValue: (row) => row.complete_docs_send_time },
  { key: "billing_completed_time", label: "新增账单完成时间", getValue: (row) => row.billing_completed_time },
  { key: "billing_period", label: "账期", getValue: (row) => row.billing_period },
  { key: "pieces_total", label: "件数", getValue: (row) => row.pieces_total },
  { key: "weight_total", label: "重量", getValue: (row) => row.weight_total },
  { key: "volume_total", label: "体积", getValue: (row) => row.volume_total },
  { key: "charge_weight_total", label: "计费重量", getValue: (row) => row.charge_weight_total },
];

function buildTotalReportSummaryRows(rows = []) {
  const normalizedRows = rows.map((row) => enrichOrderBillingFields(row));
  const hasDataMap = new Map(TOTAL_REPORT_FIELD_DEFINITIONS.map((field) => [field.key, false]));

  const resultRows = normalizedRows.map((row) => {
    const summary = {};

    TOTAL_REPORT_FIELD_DEFINITIONS.forEach((field) => {
      const value = field.getValue(row);
      summary[field.key] = value ?? "";
      if (isFilledValue(value)) {
        hasDataMap.set(field.key, true);
      }
    });

    return summary;
  });

  const columns = TOTAL_REPORT_FIELD_DEFINITIONS.filter((field) => {
    return field.key === "serial_number" || hasDataMap.get(field.key);
  }).map((field) => ({ key: field.key, label: field.label }));

  return {
    columns,
    rows: resultRows,
  };
}

module.exports = {
  TOTAL_REPORT_FIELD_DEFINITIONS,
  buildFilledStatusSql,
  buildTotalReportSummaryRows,
  deriveBillingPeriod,
  ensureBillingInfoSchema,
  enrichOrderBillingFields,
  isFilledValue,
  normalizeTextValue,
  parseStoredFeeItems,
};
