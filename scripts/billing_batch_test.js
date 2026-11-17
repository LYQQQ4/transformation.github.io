const assert = require("assert/strict");
const express = require("express");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const excel = require("../backend/lib/billing_excel");
const createRouter = require("../backend/routes/billing");
const fields = require("../frontend/order_summary_fields");

function fixture(serial = "0001") {
  return {
    serial_number: serial, billing_id: 1, company_name: "=1+1",
    sender_id: "00001234567890123456", customer_id: "00003", tracking_number: "0000004567",
    receive_date: new Date(2026, 9, 27), transport_mode: "空运", billing_template_key: "air",
    billing_completed_time: "2026-10-01",
    cost_items: JSON.stringify([{ category: "提货运输费", amount: "10", supplier: "keep" }, { category: "国际运费", amount: "2.5" }]),
    billing_items: JSON.stringify([{ category: "提货运输费", amount: "20", billing_period: "2026-09", remark: "keep" }]),
  };
}

function workbook(rows, headers = excel.HEADERS) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), "账单");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

function row(serial = "0001", cost = "", sales = "", period = "") {
  return [serial, "", "", "", "", "", "", "", "", "", "", "", "", "", cost, sales, period];
}

function editExport(buffer, changes) {
  const book = XLSX.read(buffer, { type: "buffer", cellDates: true });
  for (const [address, value] of Object.entries(changes)) {
    book.Sheets["账单"][address] = { t: typeof value === "number" ? "n" : "s", v: value };
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

function archiveWithEntry(buffer, name, content) {
  const archive = XLSX.CFB.read(buffer, { type: "buffer" });
  XLSX.CFB.utils.cfb_add(archive, name, content);
  return XLSX.CFB.write(archive, { type: "buffer", fileType: "zip", compression: true });
}

function fakeDb() {
  const state = { records: new Map([["0001", fixture()], ["0002", fixture("0002")]]), commits: 0, rollbacks: 0, writes: 0, audits: [], failAfter: 0 };
  const db = {
    async execute(sql, params = []) {
      if (sql.includes("CREATE TABLE")) return [[]];
      if (sql.includes("information_schema")) return [[{ count: 1 }]];
      if (sql.includes("FROM orders o")) {
        const records = [...state.records.values()].filter((record) => !params.length || params.includes(record.serial_number));
        return [records.map((record) => ({ ...record }))];
      }
      if (sql.includes("FOR UPDATE")) return [[...state.records.keys()].map((serial_number) => ({ serial_number }))];
      if (sql.startsWith("INSERT INTO billing_info")) {
        state.writes += 1;
        if (state.failAfter && state.writes >= state.failAfter) throw new Error("Injected SQL failure");
        const record = state.records.get(params[0]);
        assert.ok(record && !record.billing_id, "Only initialize an existing order without a bill");
        Object.assign(record, { billing_id: state.writes + 2, billing_template_key: params[1], cost_items: params[2], billing_items: params[3] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE billing_info")) {
        state.writes += 1;
        if (state.failAfter && state.writes >= state.failAfter) throw new Error("Injected SQL failure");
        const record = state.records.get(params.at(-1));
        let index = 0;
        if (sql.includes("cost_items = ?")) record.cost_items = params[index++];
        if (sql.includes("billing_items = ?")) record.billing_items = params[index++];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO billing_import_log")) {
        state.audits.push(params);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async getConnection() {
      let original;
      let audits;
      return {
        execute: db.execute,
        async beginTransaction() { original = structuredClone(state.records); audits = state.audits.slice(); },
        async commit() { state.commits += 1; },
        async rollback() { state.records = original; state.audits = audits; state.rollbacks += 1; },
        release() {},
      };
    },
  };
  const users = { execute: async (sql, params) => [params[0] === "1" ? [{ id: 1, role: "user" }] : []] };
  return { db, users, state };
}

async function runApiTests() {
  const { db, users, state } = fakeDb();
  const app = express();
  app.use(express.json());
  app.use("/api/billing", createRouter(db, users));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/billing`;
  async function postExport(serials, user = "1") {
    return fetch(`${base}/export`, { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": user }, body: JSON.stringify({ serial_numbers: serials }) });
  }
  async function postImport(buffer, name = "filled.xlsx", user = "1") {
    const form = new FormData();
    form.append("file", new Blob([buffer]), name);
    const response = await fetch(`${base}/import`, { method: "POST", headers: { "x-user-id": user }, body: form });
    return { status: response.status, data: await response.json() };
  }
  try {
    const exported = await postExport(["0001", "0002"]);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-disposition"), /filename\*=UTF-8/);
    const bytes = Buffer.from(await exported.arrayBuffer());
    const book = XLSX.read(bytes, { type: "buffer" });
    const sheet = book.Sheets["账单"];
    assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 })[0], excel.HEADERS);
    assert.equal(sheet.A2.v, "0001");
    assert.equal(sheet.F2.v, "00001234567890123456");
    assert.equal(sheet.B2.v, "=1+1");
    assert.equal(sheet.B2.f, undefined);
    assert.equal(sheet.O2.t, "n");
    assert.equal(sheet.H2.v, "2026-10-27");
    assert.equal((await postExport([])).status, 400);
    assert.equal((await postExport(["0001"], "")).status, 401);
    assert.equal((await postExport(["0001"], "999")).status, 401);
    assert.equal((await postExport(["0001", "missing"])).status, 400);
    assert.equal((await postExport(["0001", "0001"])).status, 400);
    assert.equal((await postExport(Array.from({ length: 501 }, (_, index) => String(index)))).status, 400);
    assert.equal((await postExport(["' OR 1=1 --"])).status, 400);
    assert.equal((await postImport(workbook([row()]), "a.xlsx", "")).status, 401);
    assert.equal((await postImport(workbook([row()]), "a.xlsx", "999")).status, 401);

    let result = await postImport(editExport(bytes, { O2: 22.75, P2: 35.25, Q2: "2026-10", B2: "Do not save" }));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.deepEqual(result.data.summary, { total: 2, updated: 1, failed: 0, skipped: 1, duplicated: 0 });
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").cost_items), "22.75");
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").billing_items), "35.25");
    assert.equal(fields.deriveBillingPeriod({ billing_items: state.records.get("0001").billing_items }), "2026-10");
    assert.equal(state.records.get("0001").company_name, "=1+1");
    assert.equal(JSON.parse(state.records.get("0001").cost_items)[0].supplier, "keep");
    assert.equal(state.records.get("0001").billing_completed_time, "2026-10-01");
    assert.ok(result.data.warnings.some((warning) => warning.field === "公司名称"));
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0][0], "1");
    assert.equal(state.audits[0][2].length, 64);

    const before = state.records.get("0001").cost_items;
    result = await postImport(workbook([row("0001", "", "", "月结30天")]));
    assert.equal(result.data.summary.updated, 1);
    assert.equal(state.records.get("0001").cost_items, before);
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").billing_items), "35.25");
    result = await postImport(workbook([row()]));
    assert.equal(result.data.summary.skipped, 1);
    result = await postImport(workbook([row("0001", 0, "", new Date(2026, 10, 15))]));
    assert.equal(result.data.summary.updated, 1);
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").cost_items), "0");
    assert.equal(fields.deriveBillingPeriod({ billing_items: state.records.get("0001").billing_items }), "2026-11-15");
    result = await postImport(workbook([row(123, 10)]));
    assert.equal(result.data.summary.failed, 1);
    assert.match(result.data.errors[0].message, /文本单元格/);
    result = await postImport(workbook([
      row("0001", "bad"), row("0002", "", "NaN"), row("missing", 10),
      row("dup", 1), row("dup", 2), row("", 1), row("0002", "", "", "2026-13"),
    ]));
    // Both occurrences of 0002 are duplicates and neither may be updated.
    assert.deepEqual(result.data.summary, { total: 7, updated: 0, failed: 3, skipped: 4, duplicated: 4 });
    assert.ok(result.data.notFoundSerialNumbers.includes("missing"));
    assert.ok(result.data.errors.every((error) => error.row >= 2 && error.field && error.message));
    const report = XLSX.read(Buffer.from(result.data.errorReport.base64, "base64"), { type: "buffer" });
    const reportRows = XLSX.utils.sheet_to_json(report.Sheets["账单"], { header: 1 });
    assert.equal(reportRows[0].at(-1), "错误原因");
    assert.equal(reportRows.length, 8);
    for (const [cost, sales, period, field] of [
      ["bad", "", "", "成本"], ["", "NaN", "", "销售"], ["", "", "2026-13", "账期"],
      ["", "", "2026-02-30", "账期"], ["", "", "x".repeat(256), "账期"],
      ["12.123", "", "", "成本"], ["12.00001", "", "", "成本"],
      ["", "0.001", "", "销售"], ["Infinity", "", "", "成本"],
    ]) {
      result = await postImport(workbook([row("0001", cost, sales, period)]));
      assert.equal(result.data.summary.failed, 1, JSON.stringify(result));
      assert.equal(result.data.errors[0].field, field);
    }
    result = await postImport(workbook([row("0001", 23), row("missing", 24)]));
    assert.equal(result.data.summary.updated, 1);
    assert.equal(result.data.summary.failed, 1);
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").cost_items), "23");

    const beforeRollback = structuredClone(state.records);
    const beforeAudits = state.audits.length;
    state.failAfter = state.writes + 2;
    result = await postImport(workbook([row("0001", 99), row("0002", 100)]));
    assert.equal(result.status, 500);
    assert.deepEqual(state.records, beforeRollback);
    assert.equal(state.audits.length, beforeAudits);
    assert.equal(state.rollbacks, 1);
    state.failAfter = 0;

    // A stale, unchanged value from the export must never overwrite a newer value.
    result = await postImport(editExport(bytes, { Q2: "2026-11" }));
    assert.equal(result.data.summary.failed, 1); // period changed since export
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").cost_items), "23");
    result = await postImport(editExport(bytes, { O2: 24 }));
    assert.equal(result.data.summary.failed, 1); // explicitly edited stale cost
    result = await postImport(bytes);
    assert.equal(result.data.summary.updated, 0);
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").cost_items), "23");
    const freshExport = Buffer.from(await (await postExport(["0001"])).arrayBuffer());
    await postImport(workbook([row("0001", 27)]));
    result = await postImport(editExport(freshExport, { P2: 40 }));
    assert.equal(result.data.summary.updated, 1);
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").cost_items), "27");
    assert.equal(fields.sumFeeItemAmounts(state.records.get("0001").billing_items), "40");

    assert.equal((await postImport(workbook([row()], excel.HEADERS.slice(1)))).status, 400);
    const swapped = excel.HEADERS.slice();
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    assert.equal((await postImport(workbook([row()], swapped))).status, 400);
    assert.equal((await postImport(Buffer.from("not an excel"))).status, 400);
    assert.equal((await postImport(Buffer.from("PK"))).status, 400);
    assert.equal((await postImport(workbook([row()]), "evil.html")).status, 400);
    for (const name of ["xl/vbaProject.bin", "xl/externalLinks/externalLink1.xml", "../payload.xml"]) {
      assert.equal((await postImport(archiveWithEntry(bytes, name, Buffer.from("unsafe")))).status, 400);
    }
    assert.equal((await postImport(archiveWithEntry(bytes, "xl/large.xml", Buffer.alloc(21 * 1024 * 1024)))).status, 400);
    const forgedName = Buffer.from(bytes);
    const entryNameSize = forgedName.readUInt16LE(26);
    assert.ok(entryNameSize >= 3);
    Buffer.from("../" + "x".repeat(entryNameSize - 3)).copy(forgedName, 30);
    result = await postImport(forgedName);
    assert.equal(result.status, 400);
    assert.match(result.data.error, /文件头/);
    const forgedSize = Buffer.from(bytes);
    forgedSize.writeUInt32LE(21 * 1024 * 1024, 22);
    result = await postImport(forgedSize);
    assert.equal(result.status, 400);
    assert.match(result.data.error, /文件头/);
    assert.equal((await postImport(Buffer.alloc(excel.MAX_BYTES + 1))).status, 400);
    assert.equal((await postImport(workbook(Array.from({ length: 501 }, (_, index) => row(String(index)))))).status, 400);
    const formulaBook = XLSX.read(workbook([row("0001", 3)]), { type: "buffer" });
    formulaBook.Sheets["账单"].O2 = { t: "n", v: 3, f: "1+2" };
    result = await postImport(XLSX.write(formulaBook, { type: "buffer", bookType: "xlsx" }));
    assert.equal(result.data.summary.failed, 1);
    assert.match(result.data.errors[0].message, /公式/);
    const formulaReport = XLSX.read(Buffer.from(result.data.errorReport.base64, "base64"), { type: "buffer" });
    assert.equal(formulaReport.Sheets["账单"].O2.f, undefined);
    assert.equal(formulaReport.Sheets["账单"].O2.v, "=1+2");

    for (const serial of ["unbilled", "blank", "invalid", "zero", "period", "duplicate", "rollback-new"]) {
      state.records.set(serial, {
        ...fixture(serial), billing_id: null, billing_template_key: null,
        billing_completed_time: null, cost_items: null, billing_items: null,
      });
    }
    result = await postImport(workbook([row("blank")]));
    assert.equal(result.data.summary.skipped, 1);
    assert.equal(state.records.get("blank").billing_id, null);
    result = await postImport(workbook([row("invalid", "bad")]));
    assert.equal(result.data.summary.failed, 1);
    assert.equal(state.records.get("invalid").billing_id, null);
    result = await postImport(workbook([row("duplicate", 1), row("duplicate", 2)]));
    assert.equal(result.data.summary.duplicated, 2);
    assert.equal(state.records.get("duplicate").billing_id, null);
    const unbilledExport = Buffer.from(await (await postExport(["unbilled"])).arrayBuffer());
    result = await postImport(editExport(unbilledExport, { O2: 10.25, P2: 20.5, Q2: "2026-11" }));
    assert.equal(result.data.summary.updated, 1);
    assert.deepEqual(result.data.notFoundSerialNumbers, []);
    assert.ok(state.records.get("unbilled").billing_id);
    assert.equal(state.records.get("unbilled").billing_template_key, "air");
    assert.equal(fields.sumFeeItemAmounts(state.records.get("unbilled").cost_items), "10.25");
    assert.equal(fields.sumFeeItemAmounts(state.records.get("unbilled").billing_items), "20.5");
    assert.equal(fields.deriveBillingPeriod(state.records.get("unbilled")), "2026-11");
    assert.equal(state.records.get("unbilled").company_name, "=1+1");
    result = await postImport(workbook([row("zero", 0), row("period", "", "", "月结30天")]));
    assert.equal(result.data.summary.updated, 2);
    assert.equal(fields.sumFeeItemAmounts(state.records.get("zero").cost_items), "0");
    assert.equal(state.records.get("zero").billing_items, null);
    assert.equal(state.records.get("period").cost_items, null);
    assert.equal(fields.deriveBillingPeriod(state.records.get("period")), "月结30天");
    const beforeCreateRollback = structuredClone(state.records);
    const auditsBeforeCreateRollback = state.audits.length;
    state.failAfter = state.writes + 2;
    result = await postImport(workbook([row("rollback-new", 12), row("0001", 123)]));
    assert.equal(result.status, 500);
    assert.deepEqual(state.records, beforeCreateRollback);
    assert.equal(state.audits.length, auditsBeforeCreateRollback);
    state.failAfter = 0;
    console.log("PASS: initialize unbilled orders, blank/invalid/duplicate rows, zero, period-only, insert rollback");
    const bulkRows = [];
    for (let index = 0; index < 500; index += 1) {
      const serial = `bulk${index}`;
      state.records.set(serial, fixture(serial));
      bulkRows.push(row(serial, 88.88, 99.99, "2026-10"));
    }
    const start = Date.now();
    result = await postImport(workbook(bulkRows));
    assert.equal(result.data.summary.updated, 500);
    assert.ok(Date.now() - start < 10000, "500 rows should finish within 10s");
    console.log(`PASS: HTTP export/import, validation, auth, reports, rollback, stale values, 500 rows (${Date.now() - start}ms)`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runFrontendTests() {
  const source = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");
  const checkboxes = Array.from({ length: 3 }, (_, index) => {
    const tr = { style: { display: index === 2 ? "none" : "" } };
    return { value: `000${index + 1}`, checked: false, closest() { return tr; } };
  });
  const elements = new Map(["billingSelectPage", "billingExportButton", "billingImportButton", "billingImportResults"].map((id) => [id, {}]));
  const state = { requests: [], messages: [], downloads: [], refreshed: 0, response: null };
  const context = vm.createContext({
    document: {
      querySelectorAll: () => checkboxes,
      getElementById: (id) => elements.get(id),
    },
    API_BASE: "/api", FormData, Blob, Uint8Array, atob,
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    setTimeout: (callback) => callback(),
    getAuthHeaders: (headers) => ({ ...headers, "x-user-id": "1" }),
    confirm: () => true,
    escapeHtml: (value) => String(value).replace(/</g, "&lt;"),
    showMessage: (message, type) => state.messages.push({ message, type }),
    loadBillingRecords: async () => { state.refreshed += 1; },
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      return state.response || { ok: true, blob: async () => new Blob(["excel"]) };
    },
  });
  const start = source.indexOf("const selectedBillingSerials = new Set();");
  const end = source.indexOf("function buildBillingBaseInfoItems(", start);
  vm.runInContext(source.slice(start, end), context);
  context.downloadBillingBlob = (blob, filename) => state.downloads.push(filename);
  await context.exportBillingExcel();
  assert.equal(state.requests.length, 0);
  context.toggleBillingPageSelection(true);
  assert.equal(checkboxes[0].checked, true);
  assert.equal(checkboxes[1].checked, true);
  assert.equal(checkboxes[2].checked, false);
  assert.match(elements.get("billingExportButton").textContent, /2 条/);
  await context.exportBillingExcel();
  assert.deepEqual(JSON.parse(state.requests[0].options.body), { serial_numbers: ["0001", "0002"] });
  assert.equal(state.requests[0].options.headers["x-user-id"], "1");
  assert.match(state.downloads[0], /账单批量导入模板_\d{8}.xlsx/);
  checkboxes.forEach((checkbox, index) => { checkbox.closest().style.display = index === 2 ? "" : "none"; });
  context.updateBillingSelectionState();
  assert.equal(elements.get("billingSelectPage").checked, false);
  context.toggleBillingPageSelection(true);
  assert.equal(checkboxes.filter((checkbox) => checkbox.checked).length, 3);
  context.toggleBillingPageSelection(false);
  assert.equal(checkboxes[0].checked, true);
  assert.equal(checkboxes[1].checked, true);
  assert.equal(checkboxes[2].checked, false);
  context.clearBillingSelection();
  assert.equal(elements.get("billingExportButton").disabled, true);
  const file = new File(["test"], "filled.xlsx");
  state.response = {
    ok: true,
    json: async () => ({
      success: true, summary: { total: 1, updated: 1, failed: 0, skipped: 0, duplicated: 0 },
      errors: [], warnings: [], results: [{ row: 2, trackingNumber: "0001", status: "updated" }],
    }),
  };
  await context.importBillingExcel({ files: [file], value: "file" });
  assert.equal(state.refreshed, 1);
  assert.match(elements.get("billingImportResults").innerHTML, /成功 1/);
  assert.equal(elements.get("billingImportButton").disabled, false);
  state.response = { ok: false, json: async () => ({ error: "invalid header" }) };
  await context.importBillingExcel({ files: [file], value: "file" });
  assert.match(elements.get("billingImportResults").textContent, /invalid header/);
  assert.ok(state.messages.some((message) => message.type === "error"));
  const before = state.requests.length;
  await context.importBillingExcel({ files: [new File(["test"], "evil.exe")], value: "file" });
  assert.equal(state.requests.length, before);
  console.log("PASS: frontend selection, page-only select all, export, import result and error states");
}

(async () => {
  await runApiTests();
  await runFrontendTests();
  console.log("billing_batch_test: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
