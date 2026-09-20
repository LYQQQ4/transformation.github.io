const express = require("express");
const router = express.Router();
const { sanitizeNullableString } = require("../lib/tracking_fields");
const { syncTrackingFieldsBySerial } = require("../lib/tracking_sync");
const { requireAdminAccess } = require("../lib/request_auth");
const { validateBatchDateRequest } = require("../lib/batch_date");

function normalizeCustomsSerialNumber(value) {
  return String(value || "").trim();
}

function logCustomsRouteError(routeName, context, error) {
  const payload = context ? ` ${JSON.stringify(context)}` : "";
  console.error(`[customs_clearance] ${routeName}${payload}:`, error);
}

module.exports = (db, userDb = null) => {
  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute(`
        SELECT
          c.*,
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
          t.tracking_number AS tracking_number
        FROM customs_clearance_tracking c
        LEFT JOIN orders o ON c.serial_number = o.serial_number
        LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = c.serial_number
        LEFT JOIN transfer t ON t.serial_number = c.serial_number
        ORDER BY c.serial_number DESC
      `);
      res.json({ records: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT
           c.*,
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
           t.tracking_number AS tracking_number
         FROM customs_clearance_tracking c
         LEFT JOIN orders o ON c.serial_number = o.serial_number
         LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = c.serial_number
         LEFT JOIN transfer t ON t.serial_number = c.serial_number
         WHERE c.id = ?`,
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "记录未找到" });
      }
      res.json({ record: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/serial/:serial_number", async (req, res) => {
    try {
      const serialNumber = normalizeCustomsSerialNumber(req.params.serial_number);
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const [rows] = await db.execute(
        `SELECT
           c.*,
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
           t.tracking_number AS tracking_number
         FROM customs_clearance_tracking c
         LEFT JOIN orders o ON c.serial_number = o.serial_number
         LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = c.serial_number
         LEFT JOIN transfer t ON t.serial_number = c.serial_number
         WHERE c.serial_number = ?`,
        [serialNumber]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "记录未找到" });
      }
      res.json({ record: rows[0] });
    } catch (err) {
      logCustomsRouteError("getBySerial", { serial_number: req.params.serial_number }, err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/batch-date", async (req, res) => {
    let connection = null;
    let transactionStarted = false;

    try {
      await requireAdminAccess(userDb, req, "报关板块批量日期修改");
      const validated = validateBatchDateRequest("customs", req.body);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }

      const { field, definition, serialNumbers, value } = validated;
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      const placeholders = serialNumbers.map(() => "?").join(", ");
      const [rows] = await connection.execute(
        `SELECT serial_number FROM ${definition.tableName} WHERE serial_number IN (${placeholders})`,
        serialNumbers
      );
      const existing = new Set(rows.map((row) => String(row.serial_number || "").trim()));
      const found = serialNumbers.filter((serialNumber) => existing.has(serialNumber));
      const notFound = serialNumbers.filter((serialNumber) => !existing.has(serialNumber));

      if (found.length > 0) {
        const updatePlaceholders = found.map(() => "?").join(", ");
        await connection.execute(
          `UPDATE ${definition.tableName} SET ${definition.columnName} = ? WHERE serial_number IN (${updatePlaceholders})`,
          [value, ...found]
        );
      }

      await connection.commit();
      transactionStarted = false;
      return res.json({
        message: "报关板块日期批量更新完成",
        module: "customs",
        field,
        value,
        updated_count: found.length,
        not_found_serial_numbers: notFound,
      });
    } catch (err) {
      if (connection && transactionStarted) {
        await connection.rollback();
      }
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  });

  router.post("/", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      const {
        serial_number,
        transport_mode,
        customs_start_time,
        tax_payment_time,
        release_time,
        customs_declaration_number,
        customs_supplier,
        remark1,
        remark2,
      } = req.body;

      if (!serial_number) {
        return res.status(400).json({ error: "流水号不能为空" });
      }

      await connection.beginTransaction();
      transactionStarted = true;

      const sql = `
        INSERT INTO customs_clearance_tracking (
          serial_number,
          customs_start_time,
          tax_payment_time,
          release_time,
          customs_declaration_number,
          customs_supplier,
          remark1,
          remark2
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const [result] = await connection.execute(sql, [
        serial_number,
        customs_start_time || null,
        tax_payment_time || null,
        release_time || null,
        customs_declaration_number || null,
        customs_supplier || null,
        remark1 || null,
        remark2 || null,
      ]);

      await syncTrackingFieldsBySerial(connection, serial_number, {
        transport_mode: sanitizeNullableString(transport_mode),
        remark1: sanitizeNullableString(remark1),
        remark2: sanitizeNullableString(remark2),
        excludeTables: ["customs_clearance_tracking"],
      });

      await connection.commit();
      res.status(201).json({
        message: "报关信息跟踪记录创建成功",
        id: result.insertId,
      });
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  router.put("/:id", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      const {
        serial_number,
        transport_mode,
        customs_start_time,
        tax_payment_time,
        release_time,
        customs_declaration_number,
        customs_supplier,
        remark1,
        remark2,
      } = req.body;

      if (!serial_number) {
        return res.status(400).json({ error: "流水号不能为空" });
      }

      await connection.beginTransaction();
      transactionStarted = true;

      const sql = `
        UPDATE customs_clearance_tracking SET
          serial_number = ?,
          customs_start_time = ?,
          tax_payment_time = ?,
          release_time = ?,
          customs_declaration_number = ?,
          customs_supplier = ?,
          remark1 = ?,
          remark2 = ?
        WHERE id = ?
      `;

      const [result] = await connection.execute(sql, [
        serial_number,
        customs_start_time || null,
        tax_payment_time || null,
        release_time || null,
        customs_declaration_number || null,
        customs_supplier || null,
        remark1 || null,
        remark2 || null,
        req.params.id,
      ]);

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "记录未找到" });
      }

      await syncTrackingFieldsBySerial(connection, serial_number, {
        transport_mode: sanitizeNullableString(transport_mode),
        remark1: sanitizeNullableString(remark1),
        remark2: sanitizeNullableString(remark2),
        excludeTables: ["customs_clearance_tracking"],
      });

      await connection.commit();
      res.json({ message: "报关信息跟踪记录更新成功" });
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  router.put("/serial/:serial_number", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      const serialNumber = normalizeCustomsSerialNumber(req.params.serial_number);
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const {
        transport_mode,
        customs_start_time,
        tax_payment_time,
        release_time,
        customs_declaration_number,
        customs_supplier,
        remark1,
        remark2,
      } = req.body;

      await connection.beginTransaction();
      transactionStarted = true;

      const sql = `
        UPDATE customs_clearance_tracking SET
          customs_start_time = ?,
          tax_payment_time = ?,
          release_time = ?,
          customs_declaration_number = ?,
          customs_supplier = ?,
          remark1 = ?,
          remark2 = ?
        WHERE serial_number = ?
      `;

      const [result] = await connection.execute(sql, [
        customs_start_time || null,
        tax_payment_time || null,
        release_time || null,
        customs_declaration_number || null,
        customs_supplier || null,
        remark1 || null,
        remark2 || null,
        serialNumber,
      ]);

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "记录未找到" });
      }

      await syncTrackingFieldsBySerial(connection, serialNumber, {
        transport_mode: sanitizeNullableString(transport_mode),
        remark1: sanitizeNullableString(remark1),
        remark2: sanitizeNullableString(remark2),
        excludeTables: ["customs_clearance_tracking"],
      });

      await connection.commit();
      res.json({ message: "报关信息跟踪记录更新成功" });
    } catch (err) {
      logCustomsRouteError("updateBySerial", { serial_number: req.params.serial_number, body: req.body }, err);
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const [result] = await db.execute(
        "DELETE FROM customs_clearance_tracking WHERE id = ?",
        [req.params.id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "记录未找到" });
      }

      res.json({ message: "报关信息跟踪记录删除成功" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
