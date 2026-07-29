const express = require("express");

const router = express.Router();

const { requireAdminAccess } = require("../lib/request_auth");
const { buildTotalReportSummaryRows, ensureBillingInfoSchema } = require("../lib/reporting");

function normalizeReportType(value) {
  return String(value || "total").trim().toLowerCase();
}

function normalizeSerialNumberKeyword(value) {
  return String(value || "").trim();
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
      COALESCE(pt.transport_mode, t.transport_mode) AS transport_mode,
      t.tracking_number,
      pt.pickup_date,
      COALESCE(t.arrival_port_time, pt.arrival_time) AS arrival_time,
      pt.customs_port,
      pt.customs_title,
      c.customs_start_time,
      c.tax_payment_time,
      c.release_time,
      c.customs_declaration_number,
      c.customs_supplier,
      t.arrival_port_time,
      t.clearance_time,
      t.delivery_time,
      t.complete_docs_send_time,
      t.billing_period AS billing_period_raw,
      b.billing_completed_time,
      b.billing_items AS billing_items_raw,
      pkg.pieces_total,
      pkg.weight_total,
      pkg.volume_total,
      pkg.charge_weight_total
    FROM orders o
    LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = o.serial_number
    LEFT JOIN customs_clearance_tracking c ON c.serial_number = o.serial_number
    LEFT JOIN transfer t ON t.serial_number = o.serial_number
    LEFT JOIN billing_info b ON b.serial_number = o.serial_number
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
    ${whereClause}
  `;
}

module.exports = (db, userDb) => {
  router.get("/summary", async (req, res) => {
    try {
      await requireAdminAccess(userDb, req, "报表管理");
      await ensureBillingInfoSchema(db);

      const reportType = normalizeReportType(req.query.report_type);
      if (reportType !== "total") {
        return res.status(400).json({ error: "当前仅支持总报表" });
      }

      const serialNumber = normalizeSerialNumberKeyword(req.query.serial_number);
      const conditions = [];
      const params = [];

      if (serialNumber) {
        conditions.push("o.serial_number LIKE ?");
        params.push(`%${serialNumber}%`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [rows] = await db.execute(
        `${buildReportBaseSql(whereClause)} ORDER BY o.serial_number DESC`,
        params
      );

      const summary = buildTotalReportSummaryRows(rows);
      return res.json({
        report_type: "total",
        serial_number: serialNumber,
        columns: summary.columns,
        rows: summary.rows,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  return router;
};
