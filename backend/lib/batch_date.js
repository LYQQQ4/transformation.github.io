const BATCH_DATE_FIELD_DEFINITIONS = {
  order: {
    receive_date: {
      tableName: "orders",
      columnName: "receive_date",
      includeTime: false,
      label: "接受指令日期",
    },
  },
  pickup: {
    pickup_date: {
      tableName: "pickup_transport_tracking",
      columnName: "pickup_date",
      includeTime: false,
      label: "提货日期",
    },
    arrival_time: {
      tableName: "pickup_transport_tracking",
      columnName: "arrival_time",
      includeTime: false,
      label: "到货时间",
    },
  },
  customs: {
    customs_start_time: {
      tableName: "customs_clearance_tracking",
      columnName: "customs_start_time",
      includeTime: false,
      label: "报关开始时间",
    },
    tax_payment_time: {
      tableName: "customs_clearance_tracking",
      columnName: "tax_payment_time",
      includeTime: false,
      label: "付税时间",
    },
    release_time: {
      tableName: "customs_clearance_tracking",
      columnName: "release_time",
      includeTime: false,
      label: "放行时间",
    },
  },
  transfer: {
    pickup_date: {
      tableName: "transfer",
      columnName: "pickup_date",
      includeTime: false,
      label: "提货日期",
    },
    arrival_port_time: {
      tableName: "transfer",
      columnName: "arrival_port_time",
      includeTime: false,
      label: "到货时间",
    },
    clearance_time: {
      tableName: "transfer",
      columnName: "clearance_time",
      includeTime: false,
      label: "放行时间",
    },
    delivery_time: {
      tableName: "transfer",
      columnName: "delivery_time",
      includeTime: false,
      label: "送达时间",
    },
    complete_docs_send_time: {
      tableName: "transfer",
      columnName: "complete_docs_send_time",
      includeTime: false,
      label: "完整单据回复时间",
    },
  },
  billing: {
    billing_completed_time: {
      tableName: "billing_info",
      columnName: "billing_completed_time",
      includeTime: false,
      label: "账单完成时间",
    },
  },
};

function getBatchDateFieldDefinition(moduleName, fieldName) {
  return BATCH_DATE_FIELD_DEFINITIONS[moduleName]?.[fieldName] || null;
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

module.exports = {
  BATCH_DATE_FIELD_DEFINITIONS,
  getBatchDateFieldDefinition,
  normalizeBatchDateValue,
  normalizeBatchSerialNumbers,
  validateBatchDateRequest,
};
