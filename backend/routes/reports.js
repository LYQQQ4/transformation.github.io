const express = require("express");
const XLSX = require("xlsx");

const { requireAdminAccess } = require("../lib/request_auth");
const {
  buildTotalReportSummaryRows,
  ensureBillingInfoSchema,
  ensureReportSchema,
  normalizeSelectedReportFieldKeys,
} = require("../lib/reporting");

function normalizeReportType(value) {
  return String(value || "total").trim().toLowerCase();
}

function normalizeSerialNumberKeyword(value) {
  return String(value || "").trim();
}

function parseSelectedReportFields(value) {
  if (Array.isArray(value)) {
    return normalizeSelectedReportFieldKeys(
      value.flatMap((item) => String(item || "").split(","))
    );
  }

  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalizedValue);
    if (Array.isArray(parsed)) {
      return normalizeSelectedReportFieldKeys(parsed);
    }
  } catch (error) {
    // Fall back to comma-separated parsing.
  }

  return normalizeSelectedReportFieldKeys(normalizedValue.split(","));
}

function buildReportBaseSql(whereClause = "") {
  return `
    SELECT
      o.serial_number,
      o.company_name,
      o.orderer,
      o.business_type,
      o.sender_id,
      o.customer_id,
      o.receive_date,
      o.origin AS order_origin,
      o.destination AS order_destination,
      o.trade_term,
      o.product_name AS order_product_name,
      o.remark1 AS order_remark1,
      o.remark2 AS order_remark2,
      COALESCE(pt.transport_mode, t.transport_mode) AS transport_mode,
      t.tracking_number,
      pt.pickup_date,
      COALESCE(t.arrival_port_time, pt.arrival_time) AS arrival_time,
      COALESCE(
        NULLIF(TRIM(pt.cargo_flow_info), ''),
        NULLIF(TRIM(t.cargo_flow_info), '')
      ) AS cargo_flow_info,
      COALESCE(
        NULLIF(TRIM(pt.value_added_services), ''),
        NULLIF(TRIM(t.value_added_services), '')
      ) AS value_added_services,
      pt.remark1 AS pickup_remark1_source,
      pt.remark2 AS pickup_remark2_source,
      pt.customs_port,
      pt.customs_title,
      c.customs_start_time,
      c.tax_payment_time,
      c.release_time,
      c.customs_declaration_number,
      c.customs_supplier,
      c.remark1 AS customs_remark1_source,
      c.remark2 AS customs_remark2_source,
      t.arrival_port_time,
      t.clearance_time,
      t.delivery_time,
      t.complete_docs_send_time,
      t.billing_period AS billing_period_raw,
      t.remark1 AS transfer_remark1_source,
      t.remark2 AS transfer_remark2_source,
      b.billing_completed_time,
      b.billing_items AS billing_items_raw,
      pkg.pieces_total,
      pkg.weight_total,
      pkg.volume_total,
      pkg.charge_weight_total,
      pkg.package_remark1,
      pkg.package_remark2
    FROM orders o
    LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = o.serial_number
    LEFT JOIN (
      SELECT
        serial_number,
        MAX(customs_start_time) AS customs_start_time,
        MAX(tax_payment_time) AS tax_payment_time,
        MAX(release_time) AS release_time,
        GROUP_CONCAT(NULLIF(TRIM(customs_declaration_number), '') ORDER BY id SEPARATOR '\n') AS customs_declaration_number,
        GROUP_CONCAT(NULLIF(TRIM(customs_supplier), '') ORDER BY id SEPARATOR '\n') AS customs_supplier,
        GROUP_CONCAT(NULLIF(TRIM(remark1), '') ORDER BY id SEPARATOR '\n') AS remark1,
        GROUP_CONCAT(NULLIF(TRIM(remark2), '') ORDER BY id SEPARATOR '\n') AS remark2
      FROM customs_clearance_tracking
      GROUP BY serial_number
    ) c ON c.serial_number = o.serial_number
    LEFT JOIN transfer t ON t.serial_number = o.serial_number
    LEFT JOIN billing_info b ON b.serial_number = o.serial_number
    LEFT JOIN (
      SELECT
        serial_number,
        SUM(COALESCE(pieces, 0)) AS pieces_total,
        ROUND(SUM(COALESCE(single_weight, 0) * (CASE WHEN pieces IS NULL OR pieces <= 0 THEN 1 ELSE pieces END)), 2) AS weight_total,
        ROUND(SUM(COALESCE(volume, 0) * (CASE WHEN pieces IS NULL OR pieces <= 0 THEN 1 ELSE pieces END)), 4) AS volume_total,
        MAX(charge_weight) AS charge_weight_total,
        GROUP_CONCAT(NULLIF(TRIM(remark1), '') ORDER BY package_order, id SEPARATOR '\n') AS package_remark1,
        GROUP_CONCAT(NULLIF(TRIM(remark2), '') ORDER BY package_order, id SEPARATOR '\n') AS package_remark2
      FROM \`package\`
      GROUP BY serial_number
    ) pkg ON pkg.serial_number = o.serial_number
    ${whereClause}
  `;
}

function buildReportFilter(req) {
  const serialNumber = normalizeSerialNumberKeyword(req.query.serial_number);
  const selectedFieldKeys = parseSelectedReportFields(req.query.selected_fields);
  const conditions = [];
  const params = [];

  if (serialNumber) {
    conditions.push("o.serial_number LIKE ?");
    params.push(`%${serialNumber}%`);
  }

  return {
    serialNumber,
    selectedFieldKeys,
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

async function loadReportSummary(db, reportType, filter) {
  if (reportType !== "total") {
    const error = new Error("\u5f53\u524d\u4ec5\u652f\u6301\u603b\u62a5\u8868");
    error.statusCode = 400;
    throw error;
  }

  await ensureReportSchema(db);
  const connection = await db.getConnection();
  try {
    await connection.execute("SET SESSION group_concat_max_len = 1000000");
    const [rows] = await connection.execute(
      `${buildReportBaseSql(filter.whereClause)} ORDER BY o.serial_number DESC`,
      filter.params
    );

    return buildTotalReportSummaryRows(rows, {
      selectedFieldKeys: filter.selectedFieldKeys,
    });
  } finally {
    connection.release();
  }
}

module.exports = (db, userDb) => {
  const router = express.Router();

  router.get("/summary", async (req, res) => {
    try {
      await requireAdminAccess(userDb, req, "\u62a5\u8868\u7ba1\u7406");
      await ensureBillingInfoSchema(db);

      const reportType = normalizeReportType(req.query.report_type);
      const filter = buildReportFilter(req);
      const summary = await loadReportSummary(db, reportType, filter);

      return res.json({
        report_type: "total",
        serial_number: filter.serialNumber,
        selected_fields: filter.selectedFieldKeys || [],
        columns: summary.columns,
        rows: summary.rows,
        empty_value_text: summary.emptyValueText,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  router.get("/export", async (req, res) => {
    try {
      await requireAdminAccess(userDb, req, "\u62a5\u8868\u7ba1\u7406");
      await ensureBillingInfoSchema(db);

      const reportType = normalizeReportType(req.query.report_type);
      const filter = buildReportFilter(req);
      const summary = await loadReportSummary(db, reportType, filter);
      const headerRow = summary.columns.map((column) => column.label || column.key);
      const dataRows = summary.rows.map((row) =>
        summary.columns.map((column) => row[column.key] ?? summary.emptyValueText)
      );
      const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      worksheet["!cols"] = summary.columns.map((column) => ({
        wch: Math.min(Math.max(String(column.label || column.key).length + 2, 12), 30),
      }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "\u62a5\u8868");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=\"report_export.xlsx\"");
      return res.send(buffer);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  return router;
};
