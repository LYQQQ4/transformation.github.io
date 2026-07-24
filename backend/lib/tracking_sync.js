function hasOwnField(payload, fieldName) {
  return Object.prototype.hasOwnProperty.call(payload, fieldName);
}

function buildUpdateAssignment(columnName) {
  return `${columnName} = ?`;
}

async function executeSyncUpdate(connection, options) {
  const {
    tableName,
    serialNumber,
    fieldMappings,
    payload,
    required = false,
  } = options;

  const assignments = [];
  const values = [];

  fieldMappings.forEach(({ payloadKey, columnName }) => {
    if (!hasOwnField(payload, payloadKey)) {
      return;
    }

    assignments.push(buildUpdateAssignment(columnName));
    values.push(payload[payloadKey]);
  });

  if (assignments.length === 0) {
    return;
  }

  values.push(serialNumber);

  const [result] = await connection.execute(
    `UPDATE ${tableName} SET ${assignments.join(", ")} WHERE serial_number = ?`,
    values
  );

  if (required && result.affectedRows === 0) {
    throw new Error(`${tableName} record not found for serial_number ${serialNumber}`);
  }
}

async function syncTrackingFieldsBySerial(connection, serialNumber, payload = {}) {
  const excludeTables = new Set(payload.excludeTables || []);

  if (!excludeTables.has("pickup_transport_tracking")) {
    await executeSyncUpdate(connection, {
      tableName: "pickup_transport_tracking",
      serialNumber,
      payload,
      required: true,
      fieldMappings: [
        { payloadKey: "transport_mode", columnName: "transport_mode" },
        { payloadKey: "transport_supplier", columnName: "transport_supplier" },
        { payloadKey: "cargo_flow_info", columnName: "cargo_flow_info" },
        { payloadKey: "remark1", columnName: "remark1" },
        { payloadKey: "remark2", columnName: "remark2" },
      ],
    });
  }

  if (!excludeTables.has("transfer")) {
    await executeSyncUpdate(connection, {
      tableName: "transfer",
      serialNumber,
      payload,
      required: true,
      fieldMappings: [
        { payloadKey: "transport_mode", columnName: "transport_mode" },
        { payloadKey: "transport_supplier", columnName: "supplier" },
        { payloadKey: "cargo_flow_info", columnName: "cargo_flow_info" },
        { payloadKey: "remark1", columnName: "remark1" },
        { payloadKey: "remark2", columnName: "remark2" },
      ],
    });
  }

  if (!excludeTables.has("customs_clearance_tracking")) {
    await executeSyncUpdate(connection, {
      tableName: "customs_clearance_tracking",
      serialNumber,
      payload,
      required: true,
      fieldMappings: [
        { payloadKey: "remark1", columnName: "remark1" },
        { payloadKey: "remark2", columnName: "remark2" },
      ],
    });
  }
}

module.exports = {
  syncTrackingFieldsBySerial,
};
