const express = require("express");
const router = express.Router();
const { sanitizeNullableString } = require("../lib/tracking_fields");
const { syncTrackingFieldsBySerial } = require("../lib/tracking_sync");
const { hasOrderRemarkFields, syncOrderRemarksBySerial } = require("../lib/order_remarks");
const { requireUserAccess } = require("../lib/request_auth");
const { loadOrderAccess, guardRelatedOrderWrites, assertOrderSerialAccess, assertOrderChildAccess } = require("../lib/order_access");
const { validateBatchDateRequest } = require("../lib/batch_date");
const { hydrateOrderCompanyFields } = require("../lib/order_company_fields");

function normalizeCustomsSerialNumber(value) {
  return String(value || "").trim();
}

function logCustomsRouteError(routeName, context, error) {
  const payload = context ? ` ${JSON.stringify(context)}` : "";
  console.error(`[customs_clearance] ${routeName}${payload}:`, error);
}

module.exports = (db, userDb = null) => {
  router.use(loadOrderAccess(userDb), guardRelatedOrderWrites(db, "customs_clearance_tracking"));
  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute(`
        SELECT
          c.*,
          o.remark1 AS remark1,
          o.remark2 AS remark2,
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
          t.tracking_number AS tracking_number
        FROM customs_clearance_tracking c
        LEFT JOIN orders o ON c.serial_number = o.serial_number
        LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = c.serial_number
        LEFT JOIN transfer t ON t.serial_number = c.serial_number
        WHERE (${req.orderAccess.sql()})
        ORDER BY c.serial_number DESC
      `, req.orderAccess.params);
      res.json({ records: await hydrateOrderCompanyFields(rows, userDb) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT
           c.*,
           o.remark1 AS remark1,
           o.remark2 AS remark2,
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
           t.tracking_number AS tracking_number
         FROM customs_clearance_tracking c
         LEFT JOIN orders o ON c.serial_number = o.serial_number
         LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = c.serial_number
         LEFT JOIN transfer t ON t.serial_number = c.serial_number
         WHERE c.id = ? AND (${req.orderAccess.sql()})`,
        [req.params.id, ...req.orderAccess.params]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "记录未找到" });
      }
      const [record] = await hydrateOrderCompanyFields(rows, userDb);
      res.json({ record });
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
           o.remark1 AS remark1,
           o.remark2 AS remark2,
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
           t.tracking_number AS tracking_number
         FROM customs_clearance_tracking c
         LEFT JOIN orders o ON c.serial_number = o.serial_number
         LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = c.serial_number
         LEFT JOIN transfer t ON t.serial_number = c.serial_number
         WHERE c.serial_number = ? AND (${req.orderAccess.sql()})`,
        [serialNumber, ...req.orderAccess.params]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "记录未找到" });
      }
      const [record] = await hydrateOrderCompanyFields(rows, userDb);
      res.json({ record });
    } catch (err) {
      logCustomsRouteError("getBySerial", { serial_number: req.params.serial_number }, err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/batch-date", async (req, res) => {
    let connection = null;
    let transactionStarted = false;

    try {
      await requireUserAccess(userDb, req, "报关板块批量日期修改");
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
        `SELECT child.serial_number FROM ${definition.tableName} child
         INNER JOIN orders o ON o.serial_number = child.serial_number
         WHERE child.serial_number IN (${placeholders}) AND (${req.orderAccess.sql()}) FOR UPDATE`,
        [...serialNumbers, ...req.orderAccess.params]
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
      if (hasOrderRemarkFields(req.body)) {
        await requireUserAccess(userDb, req, "order remark update");
      }
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
      await assertOrderSerialAccess(connection, req.orderAccess, serial_number, { lock: true });

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
        excludeTables: ["customs_clearance_tracking"],
      });
      if (hasOrderRemarkFields(req.body)) {
        await syncOrderRemarksBySerial(connection, serial_number, req.body);
      }

      await connection.commit();
      res.status(201).json({
        message: "报关信息跟踪记录创建成功",
        id: result.insertId,
      });
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  router.put("/:id", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      if (hasOrderRemarkFields(req.body)) {
        await requireUserAccess(userDb, req, "order remark update");
      }
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
      await assertOrderChildAccess(connection, req.orderAccess, "customs_clearance_tracking", req.params.id, { lock: true });
      await assertOrderSerialAccess(connection, req.orderAccess, serial_number, { lock: true });

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
        excludeTables: ["customs_clearance_tracking"],
      });
      await syncOrderRemarksBySerial(connection, serial_number, req.body);

      await connection.commit();
      res.json({ message: "报关信息跟踪记录更新成功" });
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  router.put("/serial/:serial_number", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      if (hasOrderRemarkFields(req.body)) {
        await requireUserAccess(userDb, req, "order remark update");
      }
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
      await assertOrderSerialAccess(connection, req.orderAccess, serialNumber, { lock: true });

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
        excludeTables: ["customs_clearance_tracking"],
      });
      await syncOrderRemarksBySerial(connection, serialNumber, req.body);

      await connection.commit();
      res.json({ message: "报关信息跟踪记录更新成功" });
    } catch (err) {
      logCustomsRouteError("updateBySerial", { serial_number: req.params.serial_number, body: req.body }, err);
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const [result] = await db.execute(
        `DELETE FROM customs_clearance_tracking WHERE id = ? AND EXISTS (
          SELECT 1 FROM orders o WHERE o.serial_number = customs_clearance_tracking.serial_number AND (${req.orderAccess.sql()})
        )`,
        [req.params.id, ...req.orderAccess.params]
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
