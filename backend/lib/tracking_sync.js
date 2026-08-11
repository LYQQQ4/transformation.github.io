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

  const assignmentValueMap = new Map();

  fieldMappings.forEach(({ payloadKey, columnName }) => {
    if (!hasOwnField(payload, payloadKey)) {
      return;
    }

    assignmentValueMap.set(columnName, payload[payloadKey]);
  });

  const assignments = Array.from(assignmentValueMap.keys()).map(buildUpdateAssignment);
  if (assignments.length === 0) {
    return;
  }

  const values = Array.from(assignmentValueMap.values());
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
        { payloadKey: "tracking_number", columnName: "tracking_number" },
        { payloadKey: "transport_mode", columnName: "transport_mode" },
        { payloadKey: "pickup_date", columnName: "pickup_date" },
        { payloadKey: "arrival_time", columnName: "arrival_time" },
        { payloadKey: "arrival_port_time", columnName: "arrival_time" },
        { payloadKey: "transport_supplier", columnName: "transport_supplier" },
        { payloadKey: "contract_number", columnName: "contract_number" },
        { payloadKey: "cargo_flow_info", columnName: "cargo_flow_info" },
        { payloadKey: "value_added_services", columnName: "value_added_services" },
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
        { payloadKey: "tracking_number", columnName: "tracking_number" },
        { payloadKey: "transport_mode", columnName: "transport_mode" },
        { payloadKey: "pickup_date", columnName: "pickup_date" },
        { payloadKey: "arrival_time", columnName: "arrival_port_time" },
        { payloadKey: "arrival_port_time", columnName: "arrival_port_time" },
        { payloadKey: "transport_supplier", columnName: "supplier" },
        { payloadKey: "contract_number", columnName: "contract_number" },
        { payloadKey: "cargo_flow_info", columnName: "cargo_flow_info" },
        { payloadKey: "value_added_services", columnName: "value_added_services" },
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
