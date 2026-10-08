const BATCH_DATE_FIELD_DEFINITIONS = {
  order: {
    receive_date: {
      tableName: "orders",
      columnName: "receive_date",
      includeTime: false,
      label: "\u63a5\u6536\u6307\u4ee4\u65e5\u671f",
    },
  },
  pickup: {
    pickup_date: {
      tableName: "pickup_transport_tracking",
      columnName: "pickup_date",
      includeTime: false,
      label: "\u63d0\u8d27\u65e5\u671f",
    },
    arrival_time: {
      tableName: "pickup_transport_tracking",
      columnName: "arrival_time",
      includeTime: true,
      label: "\u63d0\u8d27\u8ddf\u8e2a\u5230\u8d27\u65f6\u95f4",
    },
  },
  customs: {
    customs_start_time: {
      tableName: "customs_clearance_tracking",
      columnName: "customs_start_time",
      includeTime: true,
      label: "\u62a5\u5173\u5f00\u59cb\u65f6\u95f4",
    },
    tax_payment_time: {
      tableName: "customs_clearance_tracking",
      columnName: "tax_payment_time",
      includeTime: true,
      label: "\u7f34\u7a0e\u65f6\u95f4",
    },
    release_time: {
      tableName: "customs_clearance_tracking",
      columnName: "release_time",
      includeTime: true,
      label: "\u62a5\u5173\u653e\u884c\u65f6\u95f4",
    },
  },
  transfer: {
    pickup_date: {
      tableName: "transfer",
      columnName: "pickup_date",
      includeTime: false,
      label: "\u8fd0\u8f93\u63d0\u8d27\u65e5\u671f",
    },
    arrival_port_time: {
      tableName: "transfer",
      columnName: "arrival_port_time",
      includeTime: true,
      label: "\u8fd0\u8f93\u5230\u6e2f\u65f6\u95f4",
    },
    clearance_time: {
      tableName: "transfer",
      columnName: "clearance_time",
      includeTime: true,
      label: "\u8fd0\u8f93\u653e\u884c\u65f6\u95f4",
    },
    delivery_time: {
      tableName: "transfer",
      columnName: "delivery_time",
      includeTime: true,
      label: "\u8fd0\u8f93\u9001\u8fbe\u65f6\u95f4",
    },
    complete_docs_send_time: {
      tableName: "transfer",
      columnName: "complete_docs_send_time",
      includeTime: true,
      label: "\u5b8c\u6574\u5355\u636e\u56de\u590d\u65f6\u95f4",
    },
  },
  billing: {
    billing_completed_time: {
      tableName: "billing_info",
      columnName: "billing_completed_time",
      includeTime: false,
      label: "\u8d26\u5355\u5b8c\u6210\u65e5\u671f",
    },
  },
};

// Flat public keys avoid ambiguity between fields with the same business label.
const BATCH_DATE_FIELD_MAP = {
  receive_date: { moduleName: "order", ...BATCH_DATE_FIELD_DEFINITIONS.order.receive_date },
  pickup_date: { moduleName: "pickup", ...BATCH_DATE_FIELD_DEFINITIONS.pickup.pickup_date },
  pickup_arrival_time: { moduleName: "pickup", ...BATCH_DATE_FIELD_DEFINITIONS.pickup.arrival_time },
  customs_start_time: { moduleName: "customs", ...BATCH_DATE_FIELD_DEFINITIONS.customs.customs_start_time },
  tax_payment_time: { moduleName: "customs", ...BATCH_DATE_FIELD_DEFINITIONS.customs.tax_payment_time },
  release_time: { moduleName: "customs", ...BATCH_DATE_FIELD_DEFINITIONS.customs.release_time },
  transfer_pickup_date: { moduleName: "transfer", ...BATCH_DATE_FIELD_DEFINITIONS.transfer.pickup_date },
  arrival_port_time: { moduleName: "transfer", ...BATCH_DATE_FIELD_DEFINITIONS.transfer.arrival_port_time },
  clearance_time: { moduleName: "transfer", ...BATCH_DATE_FIELD_DEFINITIONS.transfer.clearance_time },
  delivery_time: { moduleName: "transfer", ...BATCH_DATE_FIELD_DEFINITIONS.transfer.delivery_time },
  complete_docs_send_time: { moduleName: "transfer", ...BATCH_DATE_FIELD_DEFINITIONS.transfer.complete_docs_send_time },
  billing_completed_time: { moduleName: "billing", ...BATCH_DATE_FIELD_DEFINITIONS.billing.billing_completed_time },
};

function getBatchDateFieldDefinition(moduleName, fieldName) {
  return BATCH_DATE_FIELD_DEFINITIONS[moduleName]?.[fieldName] || null;
}

function getUnifiedBatchDateFieldDefinition(fieldName) {
  return BATCH_DATE_FIELD_MAP[fieldName] || null;
}

function normalizeBatchSerialNumbers(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const serialNumbers = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }

    const serialNumber = item.trim();
    if (!serialNumber || serialNumber.length > 64) {
      return null;
    }

    if (!seen.has(serialNumber)) {
      seen.add(serialNumber);
      serialNumbers.push(serialNumber);
    }
  }

  return serialNumbers.length > 0 ? serialNumbers : null;
}

function normalizeBatchDateValue(value, includeTime = false) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  const pattern = includeTime
    ? /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
    : /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  if (!includeTime) {
    return normalized;
  }

  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function validateBatchDateRequest(moduleName, payload = {}) {
  const field = typeof payload.field === "string" ? payload.field.trim() : "";
  const definition = getBatchDateFieldDefinition(moduleName, field);
  if (!definition) {
    return { error: "field is not allowed for this module" };
  }

  const serialNumbers = normalizeBatchSerialNumbers(payload.serial_numbers);
  if (!serialNumbers) {
    return { error: "serial_numbers must be a non-empty array of strings" };
  }

  const value = normalizeBatchDateValue(payload.value, definition.includeTime);
  if (!value) {
    return { error: `value must be a valid ${definition.includeTime ? "date-time" : "YYYY-MM-DD"}` };
  }

  return { field, definition, serialNumbers, value };
}

function validateUnifiedBatchDateRequest(payload = {}) {
  const field = typeof payload.field === "string" ? payload.field.trim() : "";
  const definition = getUnifiedBatchDateFieldDefinition(field);
  if (!definition) {
    return { error: "field is not allowed" };
  }

  const serialNumbers = normalizeBatchSerialNumbers(payload.serial_numbers);
  if (!serialNumbers) {
    return { error: "serial_numbers must be a non-empty array of strings" };
  }

  const value = normalizeBatchDateValue(payload.value, definition.includeTime);
  if (!value) {
    return { error: `value must be a valid ${definition.includeTime ? "date-time" : "YYYY-MM-DD"}` };
  }

  return { field, definition, serialNumbers, value };
}

module.exports = {
  BATCH_DATE_FIELD_DEFINITIONS,
  BATCH_DATE_FIELD_MAP,
  getBatchDateFieldDefinition,
  getUnifiedBatchDateFieldDefinition,
  normalizeBatchDateValue,
  normalizeBatchSerialNumbers,
  validateBatchDateRequest,
  validateUnifiedBatchDateRequest,
};
