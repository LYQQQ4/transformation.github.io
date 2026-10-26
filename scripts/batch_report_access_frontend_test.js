const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { BATCH_DATE_FIELD_MAP } = require("../backend/lib/batch_date");
const { buildTotalReportSummaryRows } = require("../backend/lib/reporting");

const source = fs.readFileSync(path.join(__dirname, "..", "frontend/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "frontend/index.html"), "utf8");

function createContext(currentUser) {
  const elements = new Map();
  const state = { requests: [], messages: [], downloads: [], authShown: 0, loads: 0 };
  for (const id of [
    "orderBatchDateControls", "orderBatchDateField", "orderBatchDateValue",
    "orderBatchDateSelectedCount", "orderBatchDateButton", "orderBatchDateSelectAllButton",
    "orderBatchDateClearSelectionButton", "deleteOrdersLink", "reportManagementLink",
    "reportManagementMessage", "reportTypeSelect", "reportSerialInput",
    "ordersImportBar", "importResults", "viewOrdersPage", "viewOrdersLink",
    "deleteOrdersPage", "reportManagementPage",
  ]) {
    const classes = new Set();
    elements.set(id, {
      style: {}, value: "", innerHTML: "",
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    });
  }
  const pages = ["viewOrdersPage", "deleteOrdersPage", "reportManagementPage"].map((id) => elements.get(id));
  const links = ["viewOrdersLink", "deleteOrdersLink", "reportManagementLink"].map((id) => elements.get(id));
  const context = vm.createContext({
    currentUser,
    API_BASE: "/api",
    ORDER_SUMMARY_FIELD_API: null,
    URLSearchParams,
    URL: { createObjectURL: () => "blob:report", revokeObjectURL() {} },
    window: { addEventListener() {} },
    document: {
      getElementById: (id) => elements.get(id),
      querySelector: () => null,
      querySelectorAll(selector) {
        if (selector === ".page") return pages;
        if (selector === ".sidebar a") return links;
        return [];
      },
      createElement: () => ({ click() { state.downloads.push(this.download); } }),
      body: { appendChild() {}, removeChild() {} },
    },
    showMessage: (message, type) => state.messages.push({ message, type }),
    showAuthSection: () => { state.authShown += 1; },
    loadOrders: async () => { state.loads += 1; },
    loadDeleteOrders: () => { state.loads += 1; },
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          updated_count: 1, not_found_serial_numbers: [],
          ...buildTotalReportSummaryRows([{ serial_number: "A001" }]),
          empty_value_text: "empty",
        }),
        blob: async () => ({ size: 100 }),
      };
    },
  });
  const start = source.indexOf('const ORDER_PAGE_VIEW = "viewOrders";');
  const end = source.indexOf("function buildOrderActionButtons(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  context.renderReportTable = (...args) => { state.rendered = args; };
  const navigationStart = source.indexOf("function showPage(pageName)");
  const navigationEnd = source.indexOf("// Load initial data when page loads", navigationStart);
  assert.ok(navigationStart >= 0 && navigationEnd > navigationStart);
  vm.runInContext(source.slice(navigationStart, navigationEnd), context);
  return { context, elements, state };
}

async function testLoggedInUser(role) {
  const { context, elements, state } = createContext({ id: 1, role });
  context.updateDeleteOrdersMenuVisibility();
  assert.equal(elements.get("reportManagementLink").style.display, "block");
  assert.equal(elements.get("deleteOrdersLink").style.display, role === "admin" ? "block" : "none");
  context.updateBatchReceiveDateControlsVisibility();
  assert.equal(elements.get("orderBatchDateControls").style.display, "flex");

  context.updateOrderBatchDateFieldOptions();
  const options = elements.get("orderBatchDateField").innerHTML;
  assert.doesNotMatch(options, /billing_completed_time|\u8d26\u5355\u5b8c\u6210/);
  assert.deepEqual(
    Array.from(options.matchAll(/value="([^"]+)"/g), (match) => match[1]),
    Object.keys(BATCH_DATE_FIELD_MAP)
  );
  context.showPage("reportManagement");
  assert.equal(elements.get("reportManagementPage").style.display, "block");
  assert.equal(state.authShown, 0);

  elements.get("reportTypeSelect").value = "total";
  elements.get("reportSerialInput").value = "A001";
  await context.queryReports();
  await context.exportReports();
  await context.legacyQueryReports();
  await context.legacyExportReports();
  assert.equal(state.requests.length, 4);
  for (const request of state.requests) {
    assert.equal(request.options.headers["x-user-id"], "1");
    const url = new URL(request.url, "http://localhost");
    assert.equal(url.searchParams.get("serial_number"), "A001");
    assert.equal(url.searchParams.get("report_type"), "total");
    assert.equal(url.searchParams.has("selected_fields"), false);
  }
  assert.equal(state.rendered[0].length, 34);
  assert.deepEqual(state.downloads, ["report_export.xlsx", "report_export.xlsx"]);
  assert.equal(state.rendered[1][0].serial_number, "A001");

  elements.get("orderBatchDateField").value = "receive_date";
  elements.get("orderBatchDateValue").value = "2026-10-26";
  vm.runInContext('selectedOrderSerialNumbers.add("A001")', context);
  context.updateOrderBatchDateSelectionState();
  assert.equal(elements.get("orderBatchDateButton").disabled, false);
  await context.batchUpdateOrderDate();
  assert.equal(state.requests.length, 5);
  const batch = state.requests[4];
  assert.equal(batch.url, "/api/orders/batch-date");
  assert.equal(batch.options.method, "PUT");
  assert.equal(batch.options.headers["x-user-id"], "1");
  assert.deepEqual(JSON.parse(batch.options.body), {
    field: "receive_date", serial_numbers: ["A001"], value: "2026-10-26",
  });
  assert.equal(vm.runInContext("selectedOrderSerialNumbers.size", context), 0);
  assert.equal(state.messages.some((message) => message.type === "error"), false);

  if (role === "user") {
    context.showPage("deleteOrders");
    assert.equal(elements.get("deleteOrdersPage").style.display, "none");
    assert.ok(state.messages.some((message) => message.type === "error"));
  }
}

async function testUnauthenticatedUser(currentUser) {
  const { context, elements, state } = createContext(currentUser);
  context.updateDeleteOrdersMenuVisibility();
  assert.equal(elements.get("reportManagementLink").style.display, "none");
  assert.equal(elements.get("deleteOrdersLink").style.display, "none");
  context.updateBatchReceiveDateControlsVisibility();
  assert.equal(elements.get("orderBatchDateControls").style.display, "none");
  context.showPage("reportManagement");
  assert.equal(elements.get("reportManagementPage").style.display, "none");
  await context.queryReports();
  await context.exportReports();
  await context.legacyQueryReports();
  await context.legacyExportReports();
  await context.batchUpdateOrderDate();
  assert.equal(state.authShown, 6);
  assert.equal(state.requests.length, 0);
  assert.equal(state.downloads.length, 0);
}

function testReportPagination() {
  const { context, elements } = createContext({ id: 1, role: "user" });
  const thead = { innerHTML: "" };
  let bodyHtml = "";
  const tbody = {
    rows: [],
    get innerHTML() { return bodyHtml; },
    set innerHTML(value) {
      bodyHtml = value;
      this.rows = Array.from(value.matchAll(/<tr>/g), () => ({ style: {} }));
    },
  };
  const pagination = { innerHTML: "", style: {} };
  elements.set("reportManagementTablePagination", pagination);
  context.document.querySelector = (selector) => {
    if (selector === "#reportManagementTable thead") return thead;
    if (selector === "#reportManagementTable tbody") return tbody;
    return null;
  };
  context.escapeHtml = (value) => String(value);
  const start = source.indexOf("function formatReportCellValue(");
  const end = source.indexOf("async function legacyQueryReports(", start);
  vm.runInContext(source.slice(start, end), context);
  const summary = buildTotalReportSummaryRows(Array.from({ length: 31 }, (_, index) => ({
    serial_number: `A${index}`,
  })));
  context.renderReportTable(summary.columns, summary.rows);
  assert.equal((thead.innerHTML.match(/<th>/g) || []).length, 34);
  assert.equal((bodyHtml.match(/<td>/g) || []).length, 31 * 34);
  const visibleRows = () => tbody.rows.filter((row) => row.style.display !== "none").length;
  assert.equal(visibleRows(), 15);
  context.changeTablePage("reportManagementTable", 2);
  assert.equal(visibleRows(), 15);
  assert.equal(tbody.rows[0].style.display, "none");
  assert.equal(tbody.rows[15].style.display, "");
  context.changeTablePage("reportManagementTable", 3);
  assert.equal(visibleRows(), 1);
  context.changeTablePage("reportManagementTable", 4);
  assert.equal(visibleRows(), 1);
  context.renderReportTable(summary.columns, []);
  assert.equal((thead.innerHTML.match(/<th>/g) || []).length, 34);
  assert.equal(visibleRows(), 0);
}

async function testReportRequestStates() {
  const { context, elements, state } = createContext({ id: 1, role: "user" });
  const message = elements.get("reportManagementMessage");
  context.fetch = async () => {
    assert.match(message.textContent, /正在查询报表/);
    assert.equal(message.className, "info");
    return { ok: true, json: async () => ({ ...buildTotalReportSummaryRows([]), empty_value_text: "empty" }) };
  };
  await context.queryReports();
  assert.equal(state.rendered[0].length, 34);
  assert.equal(state.rendered[1].length, 0);
  assert.equal(state.rendered[2], "empty");
  assert.match(message.textContent, /未查询到/);

  context.fetch = async () => ({ ok: false, json: async () => ({ error: "test failure" }) });
  await context.queryReports();
  assert.equal(message.className, "error");
  assert.match(message.textContent, /查询报表失败: test failure/);
  assert.equal(state.rendered[0].length, 0);
  await context.exportReports();
  assert.equal(message.className, "error");
  assert.match(message.textContent, /导出报表失败: test failure/);
  assert.equal(state.downloads.length, 0);

  context.fetch = async () => {
    assert.match(message.textContent, /正在导出报表/);
    return { ok: true, blob: async () => ({ size: 0 }) };
  };
  await context.exportReports();
  assert.equal(message.className, "error");
  assert.match(message.textContent, /导出的报表为空/);
  assert.equal(state.downloads.length, 0);
}

function testReportPagination() {
  const { context, elements } = createContext({ id: 1, role: "user" });
  const thead = { innerHTML: "" };
  let bodyHtml = "";
  const tbody = {
    rows: [],
    get innerHTML() { return bodyHtml; },
    set innerHTML(value) {
      bodyHtml = value;
      this.rows = Array.from(value.matchAll(/<tr>/g), () => ({ style: {} }));
    },
  };
  const pagination = { innerHTML: "", style: {} };
  elements.set("reportManagementTablePagination", pagination);
  context.document.querySelector = (selector) => {
    if (selector === "#reportManagementTable thead") return thead;
    if (selector === "#reportManagementTable tbody") return tbody;
    return null;
  };
  context.escapeHtml = (value) => String(value);
  const start = source.indexOf("function formatReportCellValue(");
  const end = source.indexOf("async function legacyQueryReports(", start);
  vm.runInContext(source.slice(start, end), context);
  const summary = buildTotalReportSummaryRows(Array.from({ length: 31 }, (_, index) => ({
    serial_number: `A${index}`,
  })));
  context.renderReportTable(summary.columns, summary.rows);
  assert.equal((thead.innerHTML.match(/<th>/g) || []).length, 34);
  assert.equal((bodyHtml.match(/<td>/g) || []).length, 31 * 34);
  const visibleRows = () => tbody.rows.filter((row) => row.style.display !== "none").length;
  assert.equal(visibleRows(), 15);
  context.changeTablePage("reportManagementTable", 2);
  assert.equal(visibleRows(), 15);
  assert.equal(tbody.rows[0].style.display, "none");
  assert.equal(tbody.rows[15].style.display, "");
  context.changeTablePage("reportManagementTable", 3);
  assert.equal(visibleRows(), 1);
  context.changeTablePage("reportManagementTable", 4);
  assert.equal(visibleRows(), 1);
  context.renderReportTable(summary.columns, []);
  assert.equal((thead.innerHTML.match(/<th>/g) || []).length, 34);
  assert.equal(visibleRows(), 0);
}

async function testReportRequestStates() {
  const { context, elements, state } = createContext({ id: 1, role: "user" });
  const message = elements.get("reportManagementMessage");
  context.fetch = async () => {
    assert.match(message.textContent, /正在查询报表/);
    assert.equal(message.className, "info");
    return { ok: true, json: async () => ({ ...buildTotalReportSummaryRows([]), empty_value_text: "empty" }) };
  };
  await context.queryReports();
  assert.equal(state.rendered[0].length, 34);
  assert.equal(state.rendered[1].length, 0);
  assert.equal(state.rendered[2], "empty");
  assert.match(message.textContent, /未查询到/);

  context.fetch = async () => ({ ok: false, json: async () => ({ error: "test failure" }) });
  await context.queryReports();
  assert.equal(message.className, "error");
  assert.match(message.textContent, /查询报表失败: test failure/);
  assert.equal(state.rendered[0].length, 0);
  await context.exportReports();
  assert.equal(message.className, "error");
  assert.match(message.textContent, /导出报表失败: test failure/);
  assert.equal(state.downloads.length, 0);

  context.fetch = async () => {
    assert.match(message.textContent, /正在导出报表/);
    return { ok: true, blob: async () => ({ size: 0 }) };
  };
  await context.exportReports();
  assert.equal(message.className, "error");
  assert.match(message.textContent, /导出的报表为空/);
  assert.equal(state.downloads.length, 0);
}

async function run() {
  assert.ok(html.includes("onclick=\"showPage('reportManagement')\""));
  assert.ok(html.includes('onclick="queryReports()"'));
  assert.ok(html.includes('onclick="exportReports()"'));
  for (const role of ["admin", "user"]) await testLoggedInUser(role);
  for (const user of [null, {}]) await testUnauthenticatedUser(user);
  testReportPagination();
  await testReportRequestStates();
  testReportPagination();
  await testReportRequestStates();
  console.log("batch_report_access_frontend_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
