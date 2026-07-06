const express = require("express");
const router = express.Router();

module.exports = (db) => {
  router.get("/", async (req, res) => {
    try {
      const [tableCheck] = await db.execute("SHOW TABLES LIKE 'pickup_transport_tracking'");
      if (tableCheck.length === 0) {
        return res.status(500).json({ error: "Pickup transport tracking table does not exist" });
      }

      const [rows] = await db.execute(`
        SELECT t.*, o.company_name, o.orderer, o.business_type, o.customer_id
        FROM pickup_transport_tracking t
        LEFT JOIN orders o ON t.serial_number = o.serial_number
        ORDER BY t.created_at DESC
        LIMIT 20
      `);
      res.json({ pickupTrackings: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/serial/:serial_number", async (req, res) => {
    try {
      const [rows] = await db.execute(`
        SELECT t.*, o.company_name, o.orderer, o.business_type, o.customer_id
        FROM pickup_transport_tracking t
        LEFT JOIN orders o ON t.serial_number = o.serial_number
        WHERE t.serial_number = ?
      `, [req.params.serial_number]);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Pickup transport tracking not found" });
      }

      res.json({ pickupTracking: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/serial/:serial_number", async (req, res) => {
    try {
      const {
        transport_mode,
        tracking_number,
        origin,
        destination,
        customs_port,
        customs_title,
        pickup_date,
        arrival_time,
        transport_supplier,
        contract_number,
        cargo_flow_info,
        value_added_services,
        remark1,
        remark2
      } = req.body;

      const sql = `UPDATE pickup_transport_tracking SET
        transport_mode = ?,
        tracking_number = ?,
        origin = ?,
        destination = ?,
        customs_port = ?,
        customs_title = ?,
        pickup_date = ?,
        arrival_time = ?,
        transport_supplier = ?,
        contract_number = ?,
        cargo_flow_info = ?,
        value_added_services = ?,
        remark1 = ?,
        remark2 = ?
        WHERE serial_number = ?`;

      const sanitize = (v) => (typeof v === "undefined" ? null : v);
      const [result] = await db.execute(sql, [
        sanitize(transport_mode),
        sanitize(tracking_number),
        sanitize(origin),
        sanitize(destination),
        sanitize(customs_port),
        sanitize(customs_title),
        sanitize(pickup_date),
        sanitize(arrival_time),
        sanitize(transport_supplier),
        sanitize(contract_number),
        sanitize(cargo_flow_info),
        sanitize(value_added_services),
        sanitize(remark1),
        sanitize(remark2),
        sanitize(req.params.serial_number)
      ]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Pickup transport tracking not found" });
      }

      res.json({ message: "Pickup transport tracking updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
