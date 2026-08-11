const express = require("express");
const router = express.Router();
const {
  normalizeTransferSharedPayload,
  sanitizeNullableString,
} = require("../lib/tracking_fields");
const { syncTrackingFieldsBySerial } = require("../lib/tracking_sync");

function normalizeOptionalTrackingValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function buildDateParts(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  const date = new Date(normalizedYear, normalizedMonth - 1, normalizedDay);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== normalizedYear ||
    date.getMonth() + 1 !== normalizedMonth ||
    date.getDate() !== normalizedDay
  ) {
    return null;
  }

  return {
    year: String(normalizedYear),
    month: padDatePart(normalizedMonth),
    day: padDatePart(normalizedDay),
  };
}

function normalizeOptionalDateField(value, fieldLabel, options = {}) {
  const { includeTime = false } = options;
  const normalizedValue = normalizeOptionalTrackingValue(value);

  if (normalizedValue === "") {
    return { value: null };
  }

  if (typeof normalizedValue !== "string") {
    return { error: `${fieldLabel}格式不正确，请使用 YYYY-MM-DD 或 YYYY/MM/DD` };
  }

  const match = normalizedValue.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/
  );

  if (!match) {
    return { error: `${fieldLabel}格式不正确，请使用 YYYY-MM-DD 或 YYYY/MM/DD` };
  }

  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const dateParts = buildDateParts(year, month, day);
  if (!dateParts) {
    return { error: `${fieldLabel}不是有效日期` };
  }

  if (!includeTime) {
    return { value: `${dateParts.year}-${dateParts.month}-${dateParts.day}` };
  }

  const normalizedHour = Number(hour);
  const normalizedMinute = Number(minute);
  const normalizedSecond = Number(second);
  if (
    normalizedHour < 0 || normalizedHour > 23 ||
    normalizedMinute < 0 || normalizedMinute > 59 ||
    normalizedSecond < 0 || normalizedSecond > 59
  ) {
    return { error: `${fieldLabel}时间格式不正确，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss` };
  }

  return {
    value: `${dateParts.year}-${dateParts.month}-${dateParts.day} ${padDatePart(normalizedHour)}:${padDatePart(normalizedMinute)}:${padDatePart(normalizedSecond)}`,
  };
}

const PICKUP_SELECT_COLUMNS = `
          t.id,
          t.serial_number,
          t.transport_mode,
          tr.tracking_number AS tracking_number,
          t.origin,
          t.destination,
          t.customs_port,
          t.customs_title,
          t.pickup_date,
          t.arrival_time,
          t.transport_supplier,
          t.contract_number,
          t.cargo_flow_info,
          t.value_added_services,
          t.remark1,
          t.remark2,
          t.created_at,
          t.updated_at,
          o.company_name,
          o.orderer,
          o.business_type,
          o.sender_id,
          o.customer_id,
          o.receive_date,
          o.origin AS order_origin,
          o.destination AS order_destination,
          o.trade_term,
          o.product_name
`;

module.exports = (db) => {
  router.get("/", async (req, res) => {
    try {
      const [tableCheck] = await db.execute("SHOW TABLES LIKE 'pickup_transport_tracking'");
      if (tableCheck.length === 0) {
        return res.status(500).json({ error: "Pickup transport tracking table does not exist" });
      }

      const [rows] = await db.execute(`
        SELECT
${PICKUP_SELECT_COLUMNS}
        FROM pickup_transport_tracking t
        LEFT JOIN transfer tr ON tr.serial_number = t.serial_number
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
        SELECT
${PICKUP_SELECT_COLUMNS}
        FROM pickup_transport_tracking t
        LEFT JOIN transfer tr ON tr.serial_number = t.serial_number
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
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      const sharedFields = normalizeTransferSharedPayload(req.body);
      const {
        transport_mode,
        origin,
        destination,
        customs_port,
        customs_title,
        pickup_date,
        arrival_time,
      } = req.body;
      const {
        tracking_number,
        transport_supplier,
        contract_number,
        cargo_flow_info,
        value_added_services,
        remark1,
        remark2,
      } = sharedFields;

      if (!tracking_number) {
        return res.status(400).json({ error: "运单号不能为空" });
      }

      const pickupDateResult = normalizeOptionalDateField(pickup_date, "提货日期");
      const arrivalTimeResult = normalizeOptionalDateField(arrival_time, "到货时间", { includeTime: true });
      const dateErrors = [pickupDateResult.error, arrivalTimeResult.error].filter(Boolean);

      if (dateErrors.length > 0) {
        return res.status(400).json({ error: dateErrors.join("；") });
      }

      const serialNumber = sanitizeNullableString(req.params.serial_number);
      await connection.beginTransaction();
      transactionStarted = true;

      const [transferResult] = await connection.execute(
        "UPDATE transfer SET tracking_number = ? WHERE serial_number = ?",
        [tracking_number, serialNumber]
      );

      if (transferResult.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "Transfer not found" });
      }

      const [result] = await connection.execute(
        `UPDATE pickup_transport_tracking SET
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
         WHERE serial_number = ?`,
        [
          sanitizeNullableString(transport_mode),
          tracking_number,
          sanitizeNullableString(origin),
          sanitizeNullableString(destination),
          sanitizeNullableString(customs_port),
          sanitizeNullableString(customs_title),
          pickupDateResult.value,
          arrivalTimeResult.value,
          transport_supplier,
          contract_number,
          cargo_flow_info,
          value_added_services,
          remark1,
          remark2,
          serialNumber,
        ]
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "Pickup transport tracking not found" });
      }

      await syncTrackingFieldsBySerial(connection, serialNumber, {
        tracking_number,
        transport_mode: sanitizeNullableString(transport_mode),
        pickup_date: pickupDateResult.value,
        arrival_time: arrivalTimeResult.value,
        transport_supplier,
        contract_number,
        cargo_flow_info,
        value_added_services,
        remark1,
        remark2,
        excludeTables: ["pickup_transport_tracking"],
      });

      await connection.commit();
      res.json({ message: "Pickup transport tracking updated successfully" });
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  return router;
};
