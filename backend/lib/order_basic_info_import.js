const XLSX = require("xlsx");

const BASIC_INFO_SHEET_NAME = "\u57fa\u7840\u4fe1\u606f";
const INSTRUCTION_SHEET_NAME = "\u586b\u5199\u8bf4\u660e";
const METADATA_SHEET_NAME = "\u5bfc\u5165\u5143\u6570\u636e";
const CLEAR_MARKER = "#CLEAR#";

const BASIC_INFO_FIELDS = [
  { key: "serial_number", label: "\u6d41\u6c34\u53f7", aliases: ["serial_number", "\u6d41\u6c34\u53f7"], maxLength: 100, required: true },
  { key: "company_name", label: "\u516c\u53f8\u540d\u79f0", aliases: ["company_name", "\u516c\u53f8\u540d\u79f0"], maxLength: 200, required: true },
  { key: "orderer", label: "\u6307\u4ee4\u4eba", aliases: ["orderer", "\u6307\u4ee4\u4eba"], maxLength: 100, required: true },
  { key: "business_type", label: "\u4e1a\u52a1\u7c7b\u578b", aliases: ["business_type", "\u4e1a\u52a1\u7c7b\u578b"], maxLength: 50, required: true },
  { key: "sender_company", label: "\u53d1\u4ef6\u4eba\u516c\u53f8", aliases: ["sender_company", "\u53d1\u4ef6\u4eba\u516c\u53f8"], maxLength: 200, clearable: true },
  { key: "receiver_company", label: "\u6536\u4ef6\u4eba\u516c\u53f8", aliases: ["receiver_company", "\u6536\u4ef6\u4eba\u516c\u53f8"], maxLength: 200, clearable: true },
  { key: "sender_id", label: "\u53d1\u4ef6\u4ebaID", aliases: ["sender_id", "\u53d1\u4ef6\u4ebaid", "\u53d1\u4ef6\u4ebaID"], maxLength: 50 },
  { key: "customer_id", label: "\u5ba2\u6237ID", aliases: ["customer_id", "\u5ba2\u6237id", "\u5ba2\u6237ID"], maxLength: 50, required: true },
  { key: "receive_date", label: "\u63a5\u6536\u6307\u4ee4\u65e5\u671f", aliases: ["receive_date", "\u63a5\u6536\u6307\u4ee4\u65e5\u671f", "\u63a5\u6536\u65e5\u671f", "\u6307\u4ee4\u65e5\u671f", "\u65e5\u671f"], date: true, clearable: true },
  { key: "origin", label: "\u8d77\u59cb\u5730", aliases: ["origin", "\u8d77\u59cb\u5730"], maxLength: 100, required: true },
  { key: "destination", label: "\u76ee\u7684\u5730", aliases: ["destination", "\u76ee\u7684\u5730"], maxLength: 100, required: true },
  { key: "trade_term", label: "\u8d38\u6613\u672f\u8bed", aliases: ["trade_term", "\u8d38\u6613\u672f\u8bed"], maxLength: 50, clearable: true },
  { key: "product_name", label: "\u8d27\u7269\u54c1\u540d", aliases: ["product_name", "goods_name", "\u8d27\u7269\u54c1\u540d", "\u54c1\u540d"], maxLength: 200, clearable: true },
  { key: "transport_mode", label: "\u8fd0\u8f93\u65b9\u5f0f", aliases: ["transport_mode", "\u8fd0\u8f93\u65b9\u5f0f"], maxLength: 50, clearable: true },
  { key: "tracking_number", label: "\u8fd0\u5355\u53f7", aliases: ["tracking_number", "\u8fd0\u5355\u53f7"], maxLength: 100, clearable: true },
  { key: "pieces", label: "\u4ef6\u6570", aliases: ["pieces", "\u4ef6\u6570"], readOnly: true },
  { key: "single_weight", label: "\u5355\u4ef6\u91cd\u91cf", aliases: ["single_weight", "\u5355\u4ef6\u91cd\u91cf"], readOnly: true },
  { key: "actual_weight", label: "\u5b9e\u9645\u91cd\u91cf", aliases: ["actual_weight", "\u5b9e\u9645\u91cd\u91cf"], readOnly: true },
  { key: "transport_supplier", label: "\u8fd0\u8f93\u4f9b\u5e94\u5546", aliases: ["transport_supplier", "supplier", "\u8fd0\u8f93\u4f9b\u5e94\u5546"], maxLength: 200, clearable: true },
  { key: "value_added_services", label: "\u589e\u503c\u670d\u52a1\u5907\u6ce8", aliases: ["value_added_service_remark", "value_added_services", "\u589e\u503c\u670d\u52a1\u5907\u6ce8"], clearable: true },
  { key: "remark1", label: "\u5907\u6ce81", aliases: ["remark1", "\u5907\u6ce81"], maxLength: 1000, clearable: true },
  { key: "remark2", label: "\u5907\u6ce82", aliases: ["remark2", "\u5907\u6ce82"], maxLength: 1000, clearable: true },
  { key: "customs_port", label: "\u62a5\u5173\u53e3\u5cb8", aliases: ["customs_port", "\u62a5\u5173\u53e3\u5cb8"], maxLength: 100, clearable: true },
  { key: "customs_declaration_number", label: "\u62a5\u5173\u5355\u53f7", aliases: ["customs_declaration_number", "\u62a5\u5173\u5355\u53f7"], maxLength: 100, clearable: true },
  { key: "customs_supplier", label: "\u62a5\u5173\u4f9b\u5e94\u5546", aliases: ["customs_supplier", "\u62a5\u5173\u4f9b\u5e94\u5546"], maxLength: 200, clearable: true },
];

const FIELD_BY_KEY = new Map(BASIC_INFO_FIELDS.map((field) => [field.key, field]));
const FIELD_BY_ALIAS = new Map();
BASIC_INFO_FIELDS.forEach((field) => {
  field.aliases.forEach((alias) => FIELD_BY_ALIAS.set(normalizeHeader(alias), field.key));
});

function normalizeHeader(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

function normalizeCellText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function datePartsToValue(year, month, day) {
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
  return `${normalizedYear}-${padDatePart(normalizedMonth)}-${padDatePart(normalizedDay)}`;
}

function parseExcelSerialDate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  const wholeDays = Math.floor(numericValue);
  const date = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return datePartsToValue(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function normalizeDateValue(value) {
  if (value instanceof Date) {
    return datePartsToValue(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") {
    return parseExcelSerialDate(value);
  }

  const normalized = normalizeCellText(value);
  if (!normalized) {
    return null;
  }

  let match = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return datePartsToValue(match[1], match[2], match[3]);
  }
  match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return datePartsToValue(match[3], match[1], match[2]);
  }
  return null;
}

function isClearMarker(value) {
  return normalizeCellText(value).toUpperCase() === CLEAR_MARKER;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return normalizeCellText(value);
  }
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function buildFieldMapping() {
  return Object.fromEntries(FIELD_BY_ALIAS.entries());
}

function buildTemplateRows(orders) {
  return orders.map((order) => BASIC_INFO_FIELDS.map((field) => {
    if (field.key === "serial_number") return normalizeCellText(order.serial_number);
    if (field.key === "receive_date") return normalizeCellText(order.receive_date);
    if (field.key === "transport_supplier") return normalizeCellText(order.transport_supplier);
    if (field.key === "value_added_services") return normalizeCellText(order.value_added_services);
    return normalizeCellText(order[field.key]);
  }));
}

function setActualWeightFormulas(worksheet, rowCount) {
  const piecesColumn = BASIC_INFO_FIELDS.findIndex((field) => field.key === "pieces");
  const singleWeightColumn = BASIC_INFO_FIELDS.findIndex((field) => field.key === "single_weight");
  const actualWeightColumn = BASIC_INFO_FIELDS.findIndex((field) => field.key === "actual_weight");
  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const piecesAddress = XLSX.utils.encode_cell({ r: rowIndex, c: piecesColumn });
    const singleWeightAddress = XLSX.utils.encode_cell({ r: rowIndex, c: singleWeightColumn });
    const actualWeightAddress = XLSX.utils.encode_cell({ r: rowIndex, c: actualWeightColumn });
    const actualWeight = worksheet[actualWeightAddress]?.v;
    worksheet[actualWeightAddress] = {
      t: "n",
      v: Number.isFinite(Number(actualWeight)) ? Number(actualWeight) : 0,
      f: `IF(OR(${piecesAddress}="",${singleWeightAddress}=""),"",ROUND(${piecesAddress}*${singleWeightAddress},2))`,
    };
  }
}

function setTextColumns(worksheet, rowCount) {
  const textKeys = new Set(["serial_number", "sender_id", "customer_id", "tracking_number", "customs_declaration_number"]);
  BASIC_INFO_FIELDS.forEach((field, columnIndex) => {
    if (!textKeys.has(field.key)) return;
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (worksheet[address]) {
        worksheet[address].t = "s";
        worksheet[address].z = "@";
        worksheet[address].v = normalizeCellText(worksheet[address].v);
      }
    }
  });
}

function buildBasicInfoWorkbook(orders) {
  const workbook = XLSX.utils.book_new();
  const headers = BASIC_INFO_FIELDS.map((field) => field.label);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...buildTemplateRows(orders)]);
  setTextColumns(worksheet, orders.length);
  setActualWeightFormulas(worksheet, orders.length);
  worksheet["!cols"] = BASIC_INFO_FIELDS.map((field) => ({ wch: Math.max(14, Math.min(28, field.label.length + 8)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, BASIC_INFO_SHEET_NAME);

  const instructionRows = [
    ["\u9879\u76ee", "\u8bf4\u660e"],
    ["\u6d41\u6c34\u53f7", "\u5fc5\u586b\uff0c\u53ea\u7528\u4e8e\u5339\u914d\u5df2\u6709\u8ba2\u5355\uff0c\u4e0d\u5141\u8bb8\u4fee\u6539\u3002"],
    ["\u65e5\u671f", "\u652f\u6301 YYYY-MM-DD\u3001YYYY/MM/DD \u548c Excel \u65e5\u671f\u5e8f\u5217\u53f7\uff0c\u975e\u6cd5\u65e5\u671f\u4f1a\u6309\u884c\u5931\u8d25\u3002"],
    ["\u5fc5\u586b\u5b57\u6bb5", "\u516c\u53f8\u540d\u79f0\u3001\u6307\u4ee4\u4eba\u3001\u4e1a\u52a1\u7c7b\u578b\u3001\u5ba2\u6237ID\u3001\u8d77\u59cb\u5730\u3001\u76ee\u7684\u5730\u4e0d\u80fd\u88ab #CLEAR# \u6e05\u7a7a\u3002"],
    ["\u7528\u6237ID", "\u53d1\u4ef6\u4ebaID\u548c\u5ba2\u6237ID\u5fc5\u987b\u5b58\u5728\u4e8e\u7edf\u4e00\u7528\u6237\u6863\u6848\u3002"],
    ["\u91cd\u91cf", "\u4ef6\u6570\u3001\u5355\u4ef6\u91cd\u91cf\u4e3a\u5305\u88c5\u6570\u636e\uff0c\u5b9e\u9645\u91cd\u91cf\u7531 Excel \u81ea\u52a8\u6309\u4ef6\u6570\u00d7\u5355\u4ef6\u91cd\u91cf\u8ba1\u7b97\u3002"],
    ["\u7a7a\u503c", "\u7a7a\u5355\u5143\u683c\u9ed8\u8ba4\u4e3a\u4e0d\u4fee\u6539\u539f\u503c\uff1b\u9700\u6e05\u7a7a\u65f6\u586b\u5199 #CLEAR#\u3002"],
    ["\u5bfc\u5165\u5931\u8d25", "\u6bcf\u884c\u72ec\u7acb\u6821\u9a8c\u548c\u4e8b\u52a1\uff0c\u5355\u884c\u5931\u8d25\u4e0d\u5f71\u54cd\u5176\u4ed6\u5408\u6cd5\u884c\u3002"],
  ];
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructionRows);
  instructionSheet["!cols"] = [{ wch: 22 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, INSTRUCTION_SHEET_NAME);

  const metadataRows = [[
    "data_row",
    "serial_number",
    "updated_at",
    "pickup_updated_at",
    "transfer_updated_at",
    "customs_updated_at",
  ]];
  orders.forEach((order, index) => {
    metadataRows.push([
      index + 2,
      normalizeCellText(order.serial_number),
      formatDateTime(order.updated_at),
      formatDateTime(order.pickup_updated_at),
      formatDateTime(order.transfer_updated_at),
      formatDateTime(order.customs_updated_at),
    ]);
  });
  const metadataSheet = XLSX.utils.aoa_to_sheet(metadataRows);
  XLSX.utils.book_append_sheet(workbook, metadataSheet, METADATA_SHEET_NAME);
  if (workbook.Workbook && Array.isArray(workbook.Workbook.Sheets)) {
    const metadataDefinition = workbook.Workbook.Sheets.find((sheet) => sheet.name === METADATA_SHEET_NAME);
    if (metadataDefinition) metadataDefinition.Hidden = 1;
  }
  return workbook;
}

function parseMetadata(workbook) {
  const worksheet = workbook.Sheets[METADATA_SHEET_NAME];
  if (!worksheet) return new Map();
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: true });
  return new Map(rows.map((row) => [Number(row.data_row), {
    serial_number: normalizeCellText(row.serial_number),
    updated_at: normalizeCellText(row.updated_at),
    pickup_updated_at: normalizeCellText(row.pickup_updated_at),
    transfer_updated_at: normalizeCellText(row.transfer_updated_at),
    customs_updated_at: normalizeCellText(row.customs_updated_at),
  }]));
}

function parseBasicInfoWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const worksheet = workbook.Sheets[BASIC_INFO_SHEET_NAME];
  if (!worksheet) {
    return { fatalErrors: [`Excel \u4e2d\u7f3a\u5c11 ${BASIC_INFO_SHEET_NAME} Sheet`] };
  }
  if (!workbook.Sheets[METADATA_SHEET_NAME]) {
    return { fatalErrors: ["\u8bf7\u4f7f\u7528\u7cfb\u7edf\u5bfc\u51fa\u7684\u57fa\u7840\u4fe1\u606f\u6a21\u677f\uff0c\u4e0d\u5141\u8bb8\u624b\u5de5\u65b0\u5efa\u6d41\u6c34\u53f7"] };
  }

  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true, blankrows: false });
  if (matrix.length < 2) {
    return { fatalErrors: ["Excel \u6ca1\u6709\u53ef\u5bfc\u5165\u7684\u6570\u636e"] };
  }

  const headers = matrix[0].map(normalizeHeader);
  const mappedHeaders = headers.map((header) => FIELD_BY_ALIAS.get(header) || null);
  const headerErrors = [];
  if (!mappedHeaders.includes("serial_number")) headerErrors.push("\u7f3a\u5c11\u6d41\u6c34\u53f7\u5217");
  const seenHeaders = new Set();
  mappedHeaders.forEach((key, index) => {
    if (!key) return;
    if (seenHeaders.has(key)) headerErrors.push(`\u5b57\u6bb5\u91cd\u590d: ${BASIC_INFO_FIELDS.find((field) => field.key === key).label}`);
    seenHeaders.add(key);
    if (!headers[index]) headerErrors.push(`\u7b2c ${index + 1} \u5217\u7684\u8868\u5934\u4e3a\u7a7a`);
  });
  if (headerErrors.length) return { fatalErrors: headerErrors };

  const metadata = parseMetadata(workbook);
  const rows = [];
  for (let matrixIndex = 1; matrixIndex < matrix.length; matrixIndex += 1) {
    const sourceRow = matrix[matrixIndex];
    if (sourceRow.every((value) => normalizeCellText(value) === "")) continue;

    const values = {};
    const presentFields = new Set();
    mappedHeaders.forEach((key, columnIndex) => {
      if (!key) return;
      values[key] = sourceRow[columnIndex];
      presentFields.add(key);
    });

    const row = {
      row: matrixIndex + 1,
      serial_number: normalizeCellText(values.serial_number),
      values: {},
      updateKeys: [],
      errors: [],
      metadata: metadata.get(matrixIndex + 1) || null,
    };

    if (!row.serial_number) {
      row.errors.push("\u6d41\u6c34\u53f7\u4e0d\u80fd\u4e3a\u7a7a");
    } else if (isClearMarker(values.serial_number)) {
      row.errors.push("\u6d41\u6c34\u53f7\u4e0d\u5141\u8bb8\u4fee\u6539\u6216\u6e05\u7a7a");
    }

    if (row.metadata && row.metadata.serial_number !== row.serial_number) {
      row.errors.push("\u6d41\u6c34\u53f7\u4e0e\u6a21\u677f\u539f\u503c\u4e0d\u4e00\u81f4\uff0c\u4e0d\u5141\u8bb8\u4fee\u6539");
    }
    if (!row.metadata) {
      row.errors.push("\u5f53\u524d\u884c\u4e0d\u5728\u6a21\u677f\u5feb\u7167\u4e2d\uff0c\u8bf7\u91cd\u65b0\u5bfc\u51fa");
    }

    BASIC_INFO_FIELDS.forEach((field) => {
      if (field.key === "serial_number" || field.readOnly || !presentFields.has(field.key)) return;
      const rawValue = values[field.key];
      const textValue = normalizeCellText(rawValue);
      if (!textValue) return;
      if (isClearMarker(rawValue)) {
        if (!field.clearable) {
          row.errors.push(`${field.label}\u4e0d\u5141\u8bb8\u6e05\u7a7a`);
          return;
        }
        row.values[field.key] = null;
        row.updateKeys.push(field.key);
        return;
      }
      if (field.date) {
        const normalizedDate = normalizeDateValue(rawValue);
        if (!normalizedDate) {
          row.errors.push(`${field.label}\u683c\u5f0f\u4e0d\u6b63\u786e: ${textValue}`);
          return;
        }
        row.values[field.key] = normalizedDate;
      } else {
        if (field.maxLength && textValue.length > field.maxLength) {
          row.errors.push(`${field.label}\u4e0d\u80fd\u8d85\u8fc7 ${field.maxLength} \u4e2a\u5b57\u7b26`);
          return;
        }
        row.values[field.key] = textValue;
      }
      row.updateKeys.push(field.key);
    });

    if (!row.updateKeys.length && !row.errors.length) {
      row.errors.push("\u6ca1\u6709\u53ef\u66f4\u65b0\u7684\u5b57\u6bb5");
    }
    rows.push(row);
  }

  const serialCounts = new Map();
  rows.forEach((row) => {
    if (!row.serial_number) return;
    serialCounts.set(row.serial_number, (serialCounts.get(row.serial_number) || 0) + 1);
  });
  rows.forEach((row) => {
    if (serialCounts.get(row.serial_number) > 1) row.errors.push("\u6d41\u6c34\u53f7\u5728 Excel \u4e2d\u91cd\u590d");
  });

  return { workbook, rows, fatalErrors: [], fieldMapping: buildFieldMapping() };
}

function buildPreviewResult(parsedRows) {
  const rows = parsedRows.map((row) => ({
    row: row.row,
    serial_number: row.serial_number,
    updates: row.updateKeys.map((key) => FIELD_BY_KEY.get(key).label),
    errors: [...row.errors],
  }));
  const invalid = rows.filter((row) => row.errors.length > 0).length;
  return { total: rows.length, valid: rows.length - invalid, invalid, rows };
}

module.exports = {
  BASIC_INFO_FIELDS,
  BASIC_INFO_SHEET_NAME,
  CLEAR_MARKER,
  FIELD_BY_KEY,
  INSTRUCTION_SHEET_NAME,
  METADATA_SHEET_NAME,
  buildBasicInfoWorkbook,
  buildFieldMapping,
  buildPreviewResult,
  formatDateTime,
  isClearMarker,
  normalizeCellText,
  normalizeDateValue,
  parseBasicInfoWorkbook,
};
