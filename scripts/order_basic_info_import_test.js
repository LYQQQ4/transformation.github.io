const assert = require("assert/strict");
const XLSX = require("xlsx");
const {
  BASIC_INFO_FIELDS,
  BASIC_INFO_SHEET_NAME,
  INSTRUCTION_SHEET_NAME,
  METADATA_SHEET_NAME,
  buildBasicInfoWorkbook,
  buildPreviewResult,
  parseBasicInfoWorkbook,
} = require("../backend/lib/order_basic_info_import");

function writeWorkbook(workbook) {
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function run() {
  const workbook = buildBasicInfoWorkbook([{
    serial_number: "202610001",
    company_name: "Acme",
    orderer: "Alice",
    business_type: "Air",
    sender_id: "ch001",
    customer_id: "ch002",
    receive_date: "2026-10-27",
    origin: "Shanghai",
    destination: "New York",
    tracking_number: "000123",
    updated_at: "2026-10-27 10:20:30",
  }]);
  assert.deepEqual(workbook.SheetNames, [BASIC_INFO_SHEET_NAME, INSTRUCTION_SHEET_NAME, METADATA_SHEET_NAME]);

  const templateParsed = parseBasicInfoWorkbook(writeWorkbook(workbook));
  assert.equal(templateParsed.fatalErrors.length, 0);
  assert.equal(templateParsed.rows.length, 1);
  assert.equal(templateParsed.rows[0].serial_number, "202610001");
  assert.equal(templateParsed.rows[0].metadata.serial_number, "202610001");

  const headers = BASIC_INFO_FIELDS.map((field) => field.label);
  const manual = XLSX.utils.book_new();
  const values = [
    "202610001", "Acme", "Alice", "Air", "ch001", "ch002", 46000,
    "Shanghai", "New York", "FOB", "#CLEAR#", "Sea", "000123", "Carrier",
    "", "", "#CLEAR#", "Shanghai Port", "000045", "Customs Co",
  ];
  XLSX.utils.book_append_sheet(manual, XLSX.utils.aoa_to_sheet([headers, values]), BASIC_INFO_SHEET_NAME);
  XLSX.utils.book_append_sheet(manual, XLSX.utils.aoa_to_sheet([["item", "note"]]), INSTRUCTION_SHEET_NAME);
  const metadataRows = [["data_row", "serial_number", "updated_at"], [2, "202610001", "2026-10-27 10:20:30"]];
  XLSX.utils.book_append_sheet(manual, XLSX.utils.aoa_to_sheet(metadataRows), METADATA_SHEET_NAME);
  const parsed = parseBasicInfoWorkbook(writeWorkbook(manual));
  assert.equal(parsed.rows[0].values.receive_date, "2025-12-09");
  assert.equal(parsed.rows[0].values.product_name, null);
  assert.equal(parsed.rows[0].values.remark1, undefined);
  assert.equal(parsed.rows[0].values.remark2, null);
  assert.equal(parsed.rows[0].values.tracking_number, "000123");
  assert.equal(buildPreviewResult(parsed.rows).invalid, 0);

  const changed = XLSX.read(writeWorkbook(workbook), { type: "buffer" });
  changed.Sheets[BASIC_INFO_SHEET_NAME].A2 = { t: "s", v: "202610999" };
  const changedParsed = parseBasicInfoWorkbook(writeWorkbook(changed));
  assert.ok(changedParsed.rows[0].errors.some((error) => error.includes("\u6a21\u677f\u539f\u503c")));

  console.log("order_basic_info_import_test: ok");
}

run();
