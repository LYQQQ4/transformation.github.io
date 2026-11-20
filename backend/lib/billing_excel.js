const XLSX = require("xlsx");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { inflateRawSync } = require("zlib");
const summary = require("../../frontend/order_summary_fields");
const templates = require("../../frontend/billing_templates");
const { createHttpError } = require("./request_auth");

const MAX_ROWS = 500;
const MAX_BYTES = 5 * 1024 * 1024;
const HEADERS = [
  "流水号", "公司名称", "发件人公司", "收件人公司", "指令人", "业务类型", "发件人ID", "收件人ID",
  "接收指令日期", "起始地", "目的地", "贸易术语", "货物品名",
  "运输方式", "运单号", "成本", "销售", "账期",
];
const KEYS = [
  "serial_number", "company_name", "sender_company", "receiver_company", "orderer", "business_type", "sender_id",
  "customer_id", "receive_date", "origin", "destination", "trade_term",
  "product_name", "transport_mode", "tracking_number", "cost_total",
  "sales_total", "billing_period",
];
const SNAPSHOT_SHEET = "_billing_original";
const text = (value) => value === null || value === undefined ? "" : String(value).trim();

function calendarDate(value) {
  if (value instanceof Date) {
    return summary.formatOrderSummaryValue("receive_date", value, { emptyValueText: "" }).replace(/\//g, "-");
  }
  return text(value).slice(0, 10).replace(/\//g, "-");
}

function valuesForRecord(record) {
  return KEYS.map((key) => {
    const value = summary.getOrderSummaryFieldValue(record, key);
    return key === "receive_date" ? calendarDate(value) : text(value);
  });
}

function makeWorkbook(rows, headers = HEADERS) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address];
    // Explicit string cells never become executable Excel formulas.
    if (cell.t !== "n") {
      cell.t = "s";
      cell.v = String(cell.v ?? "");
      cell.z = "@";
    }
    delete cell.f;
    delete cell.l;
  }
  sheet["!cols"] = headers.map((_, index) => ({ wch: index === 0 ? 24 : 20 }));
  sheet["!autofilter"] = { ref: sheet["!ref"] };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "账单");
  return workbook;
}

function exportWorkbook(records) {
  const originals = records.map(valuesForRecord);
  const rows = originals.map((values) => values.map((value, index) =>
    (index === 15 || index === 16) && value !== "" ? Number(value) : value
  ));
  const workbook = makeWorkbook(rows);
  for (let row = 2; row <= rows.length + 1; row += 1) {
    for (const column of ["O", "P"]) {
      if (workbook.Sheets["账单"][`${column}${row}`]) workbook.Sheets["账单"][`${column}${row}`].z = "0.00";
    }
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(
    originals.map((values) => [values[0], JSON.stringify(values.slice(14))])
  ), SNAPSHOT_SHEET);
  workbook.Workbook = { Sheets: [{ name: "账单", Hidden: 0 }, { name: SNAPSHOT_SHEET, Hidden: 2 }] };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

// Check actual inflated sizes before handing the ZIP to the spreadsheet parser.
function inspectArchive(buffer) {
  if (buffer.length < 22 || buffer.length > MAX_BYTES || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("文件必须是有效的 .xlsx，且不超过 5MB");
  }
  let end = buffer.length - 22;
  const min = Math.max(0, buffer.length - 65557);
  while (end >= min && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < min) throw new Error("Excel ZIP 结构无效");
  const count = buffer.readUInt16LE(end + 10);
  if (count > 200 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) ||
      buffer.readUInt16LE(end + 8) !== count || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length) throw new Error("Excel 压缩包超限");
  let offset = buffer.readUInt32LE(end + 16);
  const directoryStart = offset;
  if (directoryStart + buffer.readUInt32LE(end + 12) !== end) throw new Error("Excel ZIP 目录无效");
  let total = 0;
  const names = new Set();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Excel ZIP 目录无效");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameSize = buffer.readUInt16LE(offset + 28);
    const extraSize = buffer.readUInt16LE(offset + 30);
    const commentSize = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    if (!nameSize || offset + 46 + nameSize + extraSize + commentSize > end) throw new Error("Excel ZIP 目录越界");
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString("utf8");
    if (names.has(name) || /(^\/|\\|\.\.|vbaproject|externallinks|embeddings)/i.test(name) ||
        (flags & 0x2041) || ![0, 8].includes(method) || size > 20 * 1024 * 1024 ||
        total + size > 20 * 1024 * 1024) throw new Error("Excel 包含不安全内容或解压大小超限");
    names.add(name);
    if (local + 30 > directoryStart || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("Excel ZIP 数据无效");
    const localNameSize = buffer.readUInt16LE(local + 26);
    const start = local + 30 + localNameSize + buffer.readUInt16LE(local + 28);
    if (start + compressed > directoryStart) throw new Error("Excel ZIP 数据越界");
    // SheetJS trusts local headers, so inspect exactly the same names and sizes.
    const localCompressed = buffer.readUInt32LE(local + 18);
    const localSize = buffer.readUInt32LE(local + 22);
    if (buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method ||
        buffer.subarray(local + 30, local + 30 + localNameSize).toString("utf8") !== name ||
        (!(flags & 8) && (localCompressed !== compressed || localSize !== size)) ||
        ((flags & 8) && ((localCompressed && localCompressed !== compressed) || (localSize && localSize !== size)))) {
      throw new Error("Excel ZIP 本地文件头与目录不一致");
    }
    const data = buffer.subarray(start, start + compressed);
    const inflated = method === 8 ? inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 - total }) : data;
    if (inflated.length !== size) throw new Error("Excel ZIP 大小不一致");
    total += inflated.length;
    offset += 46 + nameSize + extraSize + commentSize;
  }
  if (offset !== end) throw new Error("Excel ZIP 目录数量不一致");
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) throw new Error("文件不是有效 Excel 工作簿");
}

function parseWorkbook(buffer) {
  inspectArchive(buffer);
  const workbook = XLSX.read(buffer, {
    type: "buffer", cellDates: false, cellNF: true, cellFormula: true, sheetRows: MAX_ROWS + 2,
    bookVBA: false, cellHTML: false,
  });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > 2 ||
      (workbook.SheetNames.length === 2 && workbook.SheetNames[1] !== SNAPSHOT_SHEET)) {
    throw new Error("仅支持一张账单工作表及可选的原值快照");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (range.s.r !== 0 || range.s.c !== 0 || range.e.r > MAX_ROWS || range.e.c !== 17) {
    throw new Error(`表格必须包含 18 列，最多 ${MAX_ROWS} 行数据`);
  }
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true });
  if (HEADERS.some((header, index) => grid[0]?.[index] !== header)) throw new Error("表头缺失或顺序错误，请使用账单导出模板");
  const snapshots = {};
  const snapshot = workbook.Sheets[SNAPSHOT_SHEET];
  if (snapshot) {
    const snapshotRange = XLSX.utils.decode_range(snapshot["!fullref"] || snapshot["!ref"] || "A1");
    if (snapshotRange.e.r >= MAX_ROWS || snapshotRange.e.c > 1) throw new Error("原值快照超限");
    for (const row of XLSX.utils.sheet_to_json(snapshot, { header: 1, raw: true })) {
      const [serial, json] = row;
      let values;
      try {
        const parsed = JSON.parse(json);
        // Versions that exported the 17-column sheet before the snapshot
        // indexes were corrected stored tracking_number as the first value.
        values = Array.isArray(parsed) && parsed.length === 4 ? parsed.slice(1) : parsed;
      } catch (_error) {
        throw new Error("原值快照无效");
      }
      if (!Array.isArray(values) || values.length !== 3 || values.some((value) => typeof value !== "string" || value.length > 4096)) throw new Error("原值快照无效");
      if (Object.hasOwn(snapshots, serial)) throw new Error("原值快照流水号重复");
      Object.defineProperty(snapshots, serial, { value: values, enumerable: true });
    }
  }
  const rows = [];
  for (let index = 1; index < grid.length; index += 1) {
    const values = grid[index].slice(0, 18);
    while (values.length < 18) values.push("");
    const formulas = [];
    for (let col = 0; col < 18; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: index, c: col })];
      if (cell?.t === "n" && XLSX.SSF.is_date(cell.z || "")) {
        // Decode Excel calendar values directly; JS Date parsing can cross a day
        // at midnight due to timezone and millisecond rounding in SheetJS.
        const date = XLSX.SSF.parse_date_code(cell.v, { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) });
        values[col] = date
          ? `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`
          : "无效 Excel 日期";
      }
      if (cell?.f || cell?.l) formulas.push(col);
      if (cell?.f) values[col] = `=${cell.f}`;
      if (text(values[col]).length > 4096) throw new Error(`第 ${index + 1} 行单元格文本过长`);
    }
    if (values.every((value) => text(value) === "") && !formulas.length) continue;
    rows.push({ row: index + 1, serial: text(values[0]), values, formulas, numericSerial: typeof values[0] === "number" });
  }
  if (!rows.length) throw new Error("Excel 没有数据行");
  return { rows, snapshots };
}

function parseUpload(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(createHttpError(400, "Excel 解析超时，请缩小文件"));
    }, 8000);
    worker.once("message", (result) => {
      clearTimeout(timer);
      worker.terminate();
      if (result.error) reject(createHttpError(400, result.error));
      else resolve(result);
    });
    worker.once("error", () => {
      clearTimeout(timer);
      reject(createHttpError(400, "Excel 解析失败或内容超限"));
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(createHttpError(400, "Excel 解析失败"));
    });
  });
}

function normalizeEditable(value, index) {
  if (text(value) === "") return "";
  if (index === 17) {
    const period = value instanceof Date ? calendarDate(value) : text(value);
    // Billing periods are existing free text, not a new days/date definition.
    if (period.length > 255 || /[\x00-\x1f\x7f]/.test(period) || /^[=+@]/.test(period)) throw new Error("账期必须为不超过 255 字符的普通文本");
    if (/^\d{4}-\d{1,2}$/.test(period) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("账期月份无效");
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(period)) {
      const date = new Date(`${period.replace(/\//g, "-")}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== period.replace(/\//g, "-")) throw new Error("账期日期无效");
    }
    return period;
  }
  const raw = text(value);
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw)) || Math.abs(Number(raw)) > 999999999999.99) throw new Error(`${HEADERS[index]}必须是有效数字，绝对值不能超过 999999999999.99`);
  if (/\.\d{2}\d*[1-9]/.test(raw)) throw new Error(`${HEADERS[index]}最多保留两位小数`);
  return summary.sumFeeItemAmounts([{ amount: raw }]);
}

function sameValue(a, b, index) {
  if (index === 17) return text(a) === text(b);
  if (text(a) === "" || text(b) === "") return text(a) === text(b);
  return Number(a) === Number(b);
}

function prepareUpdate(entry, record, original) {
  const current = valuesForRecord(record);
  const changes = {};
  const errors = [];
  for (const index of entry.formulas) errors.push({ field: HEADERS[index], message: "不允许公式或超链接，请填写普通值" });
  for (let index = 15; index < 18; index += 1) {
    try {
      const value = normalizeEditable(entry.values[index], index);
      if (value === "") continue;
      const baseline = original?.[index - 15];
      if (baseline !== undefined && sameValue(value, baseline, index)) continue;
      if (sameValue(value, current[index], index)) continue;
      if (baseline !== undefined && !sameValue(current[index], baseline, index)) throw new Error(`${HEADERS[index]}已被其他操作修改，请重新导出`);
      changes[index] = value;
    } catch (error) {
      errors.push({ field: HEADERS[index], message: error.message });
    }
  }
  const warnings = [];
  for (let index = 1; index < 13; index += 1) {
    const value = index === 8 ? calendarDate(entry.values[index]) : text(entry.values[index]);
    if (value !== current[index]) warnings.push({ field: HEADERS[index], message: "与当前业务数据不一致，已忽略 Excel 中的修改" });
  }
  const cost = summary.parseFeeItems(record.cost_items).map((item) => ({ ...item }));
  const sales = summary.parseFeeItems(record.billing_items).map((item) => ({ ...item }));
  const category = templates.resolveBillingTemplate(record, {
    preferredTemplateKey: record.billing_template_key,
  }).template.categories[0].label;
  function setTotal(items, total) {
    let target = items.find((item) => item.category === category);
    if (!target) {
      target = { category };
      items.push(target);
    }
    const other = Number(summary.sumFeeItemAmounts(items.filter((item) => item !== target)) || 0);
    target.amount = String(Math.round((Number(total) - other) * 100) / 100);
  }
  if (changes[15] !== undefined) setTotal(cost, changes[15]);
  if (changes[16] !== undefined) setTotal(sales, changes[16]);
  if (changes[17] !== undefined) {
    if (!sales.length) sales.push({ category });
    sales.forEach((item) => { item.billing_period = changes[17]; });
  }
  return { errors, warnings, changes, cost, sales };
}

function errorReport(rows, errors) {
  const reasons = new Map();
  errors.forEach((error) => {
    const previous = reasons.get(error.row) || [];
    previous.push(`${error.field}: ${error.message}`);
    reasons.set(error.row, previous);
  });
  const reportRows = rows.filter((row) => reasons.has(row.row)).map((row) => [
    ...row.values.map((value) => value instanceof Date ? calendarDate(value) : value),
    reasons.get(row.row).join("；"),
  ]);
  return XLSX.write(makeWorkbook(reportRows, [...HEADERS, "错误原因"]), { type: "buffer", bookType: "xlsx" }).toString("base64");
}

async function ensureImportAuditSchema(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS billing_import_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    operator_id VARCHAR(64) NOT NULL,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    file_name VARCHAR(255) NOT NULL,
    file_sha256 CHAR(64) NOT NULL,
    file_size INT NOT NULL,
    summary_json TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

if (!isMainThread) {
  try {
    parentPort.postMessage(parseWorkbook(Buffer.from(workerData)));
  } catch (error) {
    parentPort.postMessage({ error: `Excel 校验失败：${error.message}` });
  }
}

module.exports = {
  HEADERS, KEYS, MAX_ROWS, MAX_BYTES, exportWorkbook, parseUpload, parseWorkbook,
  prepareUpdate, errorReport, ensureImportAuditSchema,
};
