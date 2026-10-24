const { createHttpError } = require("./request_auth");

const ORDER_REMARK_FIELDS = ["remark1", "remark2"];
const ORDER_REMARK_MAX_LENGTH = 1000;
const LEGACY_REMARK_TABLES = [
  "pickup_transport_tracking",
  "transfer",
  "customs_clearance_tracking",
];

function hasOwnField(payload, fieldName) {
  return Object.prototype.hasOwnProperty.call(payload || {}, fieldName);
}

function normalizeOrderRemarkValue(value, fieldName) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string or null`);
  }
  const normalized = value.trim();
  if (normalized.length > ORDER_REMARK_MAX_LENGTH) {
    throw createHttpError(400, `${fieldName} cannot exceed ${ORDER_REMARK_MAX_LENGTH} characters`);
  }
  return normalized === "" ? null : normalized;
}

function normalizeOrderRemarkPatch(payload = {}) {
  const patch = {};
  ORDER_REMARK_FIELDS.forEach((fieldName) => {
    if (hasOwnField(payload, fieldName)) {
      patch[fieldName] = normalizeOrderRemarkValue(payload[fieldName], fieldName);
    }
  });
  return patch;
}

function hasOrderRemarkFields(payload = {}) {
  return ORDER_REMARK_FIELDS.some((fieldName) => hasOwnField(payload, fieldName));
}

async function lockOrderBySerial(connection, serialNumber) {
  const [rows] = await connection.execute(
    "SELECT id, serial_number, remark1, remark2 FROM orders WHERE serial_number = ? LIMIT 1 FOR UPDATE",
    [serialNumber]
  );
  if (!rows.length) {
    throw createHttpError(404, "Order not found");
  }
  return rows[0];
}

async function syncOrderRemarksBySerial(connection, serialNumber, payload = {}) {
  const patch = normalizeOrderRemarkPatch(payload);
  const order = await lockOrderBySerial(connection, serialNumber);
  const fields = Object.keys(patch);
  if (fields.length) {
    const assignments = fields.map((fieldName) => `${fieldName} = ?`).join(", ");
    const values = fields.map((fieldName) => patch[fieldName]);
    await connection.execute(
      `UPDATE orders SET ${assignments} WHERE serial_number = ?`,
      [...values, serialNumber]
    );
  }

  const effectiveRemarks = {
    remark1: hasOwnField(patch, "remark1") ? patch.remark1 : order.remark1,
    remark2: hasOwnField(patch, "remark2") ? patch.remark2 : order.remark2,
  };

  for (const tableName of LEGACY_REMARK_TABLES) {
    await connection.execute(
      `UPDATE ${tableName} SET remark1 = ?, remark2 = ? WHERE serial_number = ?`,
      [effectiveRemarks.remark1, effectiveRemarks.remark2, serialNumber]
    );
  }

  return effectiveRemarks;
}

module.exports = {
  ORDER_REMARK_MAX_LENGTH,
  hasOrderRemarkFields,
  lockOrderBySerial,
  normalizeOrderRemarkPatch,
  syncOrderRemarksBySerial,
};
