const express = require("express");
const router = express.Router();

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
    value: `${dateParts.year}-${dateParts.month}-${dateParts.day} ${padDatePart(normalizedHour)}:${padDatePart(normalizedMinute)}:${padDatePart(normalizedSecond)}`
  };
}

module.exports = (db) => {
  router.get("/", async (req, res) => {
    try {
      const [tableCheck] = await db.execute("SHOW TABLES LIKE 'pickup_transport_tracking'");
      if (tableCheck.length === 0) {
        return res.status(500).json({ error: "Pickup transport tracking table does not exist" });
      }

      const [rows] = await db.execute(`
        SELECT
          t.*,
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
        SELECT
          t.*,
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

      const pickupDateResult = normalizeOptionalDateField(pickup_date, "提货日期");
      const arrivalTimeResult = normalizeOptionalDateField(arrival_time, "到货时间", { includeTime: true });
      const dateErrors = [pickupDateResult.error, arrivalTimeResult.error].filter(Boolean);

      if (dateErrors.length > 0) {
        return res.status(400).json({ error: dateErrors.join("；") });
      }

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

      const sanitize = (v) => {
        if (typeof v === "undefined" || v === null) {
          return null;
        }
        if (typeof v === "string") {
          const trimmed = v.trim();
          return trimmed === "" ? null : trimmed;
        }
        return v;
      };
      const [result] = await db.execute(sql, [
        sanitize(transport_mode),
        sanitize(tracking_number),
        sanitize(origin),
        sanitize(destination),
        sanitize(customs_port),
        sanitize(customs_title),
        pickupDateResult.value,
        arrivalTimeResult.value,
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
