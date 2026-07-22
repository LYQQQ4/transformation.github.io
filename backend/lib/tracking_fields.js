function sanitizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  return value;
}

function normalizeTransferSharedPayload(body = {}) {
  return {
    tracking_number: sanitizeNullableString(body.tracking_number),
    transport_supplier: sanitizeNullableString(
      body.transport_supplier !== undefined ? body.transport_supplier : body.supplier
    ),
    contract_number: sanitizeNullableString(body.contract_number),
    cargo_flow_info: sanitizeNullableString(body.cargo_flow_info),
    value_added_services: sanitizeNullableString(body.value_added_services),
    remark1: sanitizeNullableString(body.remark1),
    remark2: sanitizeNullableString(body.remark2),
  };
}

function buildTransferSharedSelect(alias = "t") {
  return [
    `${alias}.tracking_number AS tracking_number`,
    `${alias}.supplier AS transport_supplier`,
    `${alias}.contract_number AS contract_number`,
    `${alias}.cargo_flow_info AS cargo_flow_info`,
    `${alias}.value_added_services AS value_added_services`,
    `${alias}.remark1 AS remark1`,
    `${alias}.remark2 AS remark2`,
  ].join(",\n          ");
}

module.exports = {
  buildTransferSharedSelect,
  normalizeTransferSharedPayload,
  sanitizeNullableString,
};
