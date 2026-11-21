const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const XLSX = require("xlsx");
const vm = require("vm");

const orderSummaryFields = require("../frontend/order_summary_fields");
const {
  TOTAL_REPORT_FIELD_DEFINITIONS,
  buildTotalReportSummaryRows,
} = require("../backend/lib/reporting");
const createReportsRouter = require("../backend/routes/reports");
const { buildReportFilter } = require("../backend/routes/reports");

const EXPECTED_FIELD_KEYS = [
  "serial_number",
  "company_name",
  "sender_company",
  "receiver_company",
  "orderer",
  "business_type",
  "sender_id",
  "customer_id",
  "receive_date",
  "origin",
  "destination",
  "trade_term",
  "product_name",
  "transport_mode",
  "tracking_number",
  "pickup_date",
  "cargo_flow_info",
  "transport_supplier",
  "value_added_services",
  "remark1",
  "remark2",
  "arrival_time",
  "customs_port",
  "customs_start_time",
  "tax_payment_time",
  "release_time",
  "customs_declaration_number",
  "customs_supplier",
  "arrival_port_time",
  "complete_docs_send_time",
  "pieces_total",
  "weight_total",
  "volume_total",
  "cost_total",
  "sales_total",
  "billing_period",
];

const EXPECTED_FIELD_LABELS = [
  "流水号", "公司名称", "发件人公司", "收件人公司", "指令人", "业务类型", "发件人ID", "客户ID",
  "接收指令日期", "起始地", "目的地", "贸易术语", "货物品名", "运输方式",
  "运单号", "提货时间", "货物流转信息", "运输供应商", "增值服务备注",
  "备注1", "备注2", "到货时间", "报关口岸", "开始报关时间", "付税时间",
  "放行时间", "报关单号", "报关供应商", "到港时间", "完整单据回复时间", "件数", "重量",
  "体积", "成本", "销售", "账期",
];

const DATE_ONLY_FIELD_KEYS = [
  "receive_date", "pickup_date", "arrival_time", "customs_start_time",
  "tax_payment_time", "release_time", "arrival_port_time",
];

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function testUnifiedReportFieldDefinitions() {
  assert.deepStrictEqual(
    TOTAL_REPORT_FIELD_DEFINITIONS.map((field) => field.key),
    EXPECTED_FIELD_KEYS
  );
  assert.strictEqual(
    TOTAL_REPORT_FIELD_DEFINITIONS,
    orderSummaryFields.TOTAL_REPORT_FIELD_DEFINITIONS,
    "reporting must consume the shared fixed report definition"
  );
  assert.deepStrictEqual(
    TOTAL_REPORT_FIELD_DEFINITIONS.map((field) => field.label),
    EXPECTED_FIELD_LABELS
  );

  const summary = buildTotalReportSummaryRows(
    [{
      serial_number: "202609001",
      company_name: "A公司",
      sender_company: "发件公司",
      receiver_company: "收件公司",
      cost_items_raw: JSON.stringify([{ amount: "100" }]),
      billing_items_raw: JSON.stringify([{ amount: "200", billing_period: "2026-09" }]),
    }],
    { selectedFieldKeys: ["sales_total", "company_name", "cost_total", "unknown"] }
  );
  assert.deepStrictEqual(
    summary.columns.map((column) => column.key),
    EXPECTED_FIELD_KEYS
  );
  for (const options of [{}, { selectedFieldKeys: [] }, { selectedFieldKeys: ["unknown"] }]) {
    for (const rows of [[], [{}], [{ serial_number: "A001" }]]) {
      const emptySummary = buildTotalReportSummaryRows(rows, options);
      assert.deepStrictEqual(emptySummary.columns.map((column) => column.key), EXPECTED_FIELD_KEYS);
      assert.deepStrictEqual(emptySummary.columns.map((column) => column.label), EXPECTED_FIELD_LABELS);
      for (const row of emptySummary.rows) {
        assert.deepStrictEqual(Object.keys(row), EXPECTED_FIELD_KEYS);
        for (const key of EXPECTED_FIELD_KEYS.filter((key) => key !== "serial_number")) {
          assert.strictEqual(row[key], emptySummary.emptyValueText);
        }
      }
    }
  }
  const customEmpty = buildTotalReportSummaryRows([{}], { emptyValueText: "empty" });
  assert.ok(Object.values(customEmpty.rows[0]).every((value) => value === "empty"));
}

function testFieldMappingsAndFormatting() {
  const input = {
    serial_number: "202609007",
    company_name: "A公司",
    sender_company: "发件公司",
    receiver_company: "收件公司",
    orderer: "Operator",
    business_type: "Import",
    sender_id: "S001",
    customer_id: "C001",
    receive_date: "2026-09-01",
    order_origin: "Origin",
    order_destination: "Destination",
    trade_term: "DDP",
    order_product_name: "Product",
    transport_mode: "Air",
    tracking_number: "TN001",
    pickup_date: "2026-09-02",
    cargo_flow_info: "In transit",
    transport_supplier: "Carrier",
    value_added_services: "Insurance",
    order_remark1: "Unified remark",
    pickup_remark1_source: "Old remark",
    pickup_remark2_source: "Pickup remark",
    transfer_remark2_source: "Transfer remark",
    customs_remark2_source: "Pickup remark",
    arrival_time: "2026-09-03 12:13:14",
    customs_port: "Shanghai",
    customs_declaration_number: "C001\nC002",
    customs_start_time: "2026-09-04 12:13:14",
    tax_payment_time: "2026-09-05 12:13:14",
    release_time: "2026-09-06 12:13:14",
    customs_supplier: "Broker 1\nBroker 2",
    arrival_port_time: "2026-09-07 12:13:14",
    complete_docs_send_time: "2026-09-08 12:13:14",
    pieces_total: 0,
    weight_total: "12.50",
    volume_total: "0.0125",
    cost_items_raw: JSON.stringify([{ amount: "100" }, { amount: "20.5" }, { amount: "invalid" }]),
    billing_items_raw: JSON.stringify([
      { amount: "0.1", billing_period: "2026-09" },
      { amount: "0.2", billing_period: "2026-09" },
      { amount: "20", billing_period: "2026-10" },
    ]),
  };
  const expected = [
    "202609007", "A公司", "发件公司", "收件公司", "Operator", "Import", "S001", "C001", "2026/09/01",
    "Origin", "Destination", "DDP", "Product", "Air", "TN001", "2026/09/02",
    "In transit", "Carrier", "Insurance", "Unified remark",
    "提货备注：Pickup remark\n送货备注：Transfer remark", "2026/09/03",
    "Shanghai", "2026/09/04", "2026/09/05", "2026/09/06", "C001\nC002", "Broker 1\nBroker 2",
    "2026/09/07", "2026/09/08", "0", "12.50", "0.0125", "120.5", "20.3",
    "2026-09 / 2026-10",
  ];
  const summary = buildTotalReportSummaryRows([input]);
  assert.deepStrictEqual(EXPECTED_FIELD_KEYS.map((key) => summary.rows[0][key]), expected);
  const fallbackRemarks = buildTotalReportSummaryRows([{
    pickup_remark1_source: "Shared",
    transfer_remark1_source: "Shared",
  }]);
  assert.strictEqual(fallbackRemarks.rows[0].remark1, "Shared");
  return { input, expected };
}

function testFrontendUsesSharedDefinition() {
  const html = read("frontend/index.html");
  const appJs = read("frontend/app.js");

  assert.ok(html.includes('src="order_summary_fields.js"'));
  assert.ok(html.includes('id="reportCompanyNameInput"'));
  assert.ok(html.includes('placeholder="支持模糊查询公司名称"'));
  assert.ok(html.includes('id="reportSenderCompanyInput"'));
  assert.ok(html.includes('id="reportReceiverCompanyInput"'));
  assert.ok(appJs.includes("ORDER_SUMMARY_FIELD_API"));
  assert.ok(appJs.includes('params.set("company_name", companyName)'));
  assert.ok(appJs.includes('params.set("sender_company", senderCompany)'));
  assert.ok(appJs.includes('params.set("receiver_company", receiverCompany)'));
  assert.strictEqual(
    (appJs.match(/document\.getElementById\("reportCompanyNameInput"\)\?\.value\.trim\(\) \|\| ""/g) || []).length,
    4
  );
  assert.ok(appJs.includes("getOrderSummaryFieldDefinitions"));
  assert.ok(appJs.includes("buildOrderSummaryDetailItems"));
  assert.ok(appJs.includes("syncBillingTableColumns"));
  for (const obsolete of [
    "reportFieldSelectorContainer", "data-report-field-key", "setAllReportFieldsSelected",
    "getSelectedReportFieldKeys", "appendSelectedReportFields", "TOTAL_REPORT_FIELD_GROUPS",
    "ensureReportManagementFieldSelector", "selected_fields",
  ]) {
    assert.ok(!appJs.includes(obsolete), `frontend must not retain ${obsolete}`);
    assert.ok(!html.includes(obsolete));
  }

  const thead = { innerHTML: "" };
  const tbody = { innerHTML: "" };
  const paginated = [];
  const context = vm.createContext({
    REPORT_EMPTY_VALUE_TEXT: "该项未填",
    escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    document: { querySelector: (selector) => selector.endsWith("thead") ? thead : tbody },
    applyRenderedTablePagination: (tableId) => paginated.push(tableId),
  });
  const start = appJs.indexOf("function formatReportCellValue(");
  const end = appJs.indexOf("async function legacyQueryReports(", start);
  vm.runInContext(appJs.slice(start, end), context);
  for (const rows of [[], [{}], [{ serial_number: "<script>" }]]) {
    const summary = buildTotalReportSummaryRows(rows);
    context.renderReportTable(summary.columns, summary.rows, summary.emptyValueText);
    assert.deepStrictEqual(
      Array.from(thead.innerHTML.matchAll(/<th>(.*?)<\/th>/g), (match) => match[1]),
      EXPECTED_FIELD_LABELS
    );
    assert.strictEqual((tbody.innerHTML.match(/<td>/g) || []).length, rows.length * 36);
    assert.ok(!tbody.innerHTML.includes("<script>"));
  }
  assert.deepStrictEqual(paginated, Array(3).fill("reportManagementTable"));

  const urlContext = vm.createContext({
    API_BASE: "/api",
    REPORT_TYPE_TOTAL: "total",
    URLSearchParams,
    document: {
      getElementById: () => ({ value: "" }),
    },
  });
  const urlStart = appJs.indexOf("function getReportDateFilter(");
  const urlEnd = appJs.indexOf("function clearReportDateFilter(", urlStart);
  vm.runInContext(appJs.slice(urlStart, urlEnd), urlContext);
  const summaryUrl = new URL(
    urlContext.getReportRequestUrl("total", "202609", "ACompany", "SenderCo", "ReceiverCo"),
    "http://localhost"
  );
  const exportUrl = new URL(
    urlContext.getReportExportUrl("total", "202609", "ACompany", "SenderCo", "ReceiverCo"),
    "http://localhost"
  );
  for (const url of [summaryUrl, exportUrl]) {
    assert.strictEqual(url.searchParams.get("company_name"), "ACompany");
    assert.strictEqual(url.searchParams.get("serial_number"), "202609");
    assert.strictEqual(url.searchParams.get("sender_company"), "SenderCo");
    assert.strictEqual(url.searchParams.get("receiver_company"), "ReceiverCo");
  }
  const emptyCompanyUrl = new URL(
    urlContext.getReportRequestUrl("total", "202609", "", "", ""),
    "http://localhost"
  );
  assert.strictEqual(emptyCompanyUrl.searchParams.has("company_name"), false);
}

function createReportDb(rows, keyword = "202609", companyName = "") {
  const state = { queryCount: 0, connectionCount: 0, releaseCount: 0 };
  return {
    state,
    async execute(sql, params = []) {
      state.queryCount += 1;
      if (sql.includes("SHOW TABLES LIKE 'package'")) {
        return [[{ Tables_in_order_system: "package" }]];
      }
      if (sql.includes("FROM INFORMATION_SCHEMA.COLUMNS")) {
        return [[{ Field: params[0] }]];
      }
      return [[]];
    },
    async getConnection() {
      state.connectionCount += 1;
      return {
        async execute(sql, params = []) {
          if (sql.includes("SET SESSION group_concat_max_len")) {
            return [[]];
          }
          if (sql.includes("SELECT")) {
            assert.ok(sql.includes("b.billing_completed_time"));
            assert.ok(sql.includes("o.sender_company"));
            assert.ok(sql.includes("o.receiver_company"));
            assert.ok(sql.includes("pt.customs_port"));
            assert.ok(sql.includes("c.customs_declaration_number"));
            assert.ok(sql.includes("NULLIF(TRIM(pt.transport_supplier), '')"));
            assert.ok(sql.includes("NULLIF(TRIM(t.supplier), '')"));
            assert.ok(sql.includes("SUM(COALESCE(pieces, 0)) AS pieces_total"));
            assert.ok(sql.includes("ROUND(SUM(COALESCE(single_weight, 0)"));
            assert.ok(sql.includes("ROUND(SUM(COALESCE(volume, 0)"));
            assert.ok(sql.includes("MAX(customs_start_time)"));
            assert.ok(sql.includes("GROUP_CONCAT(NULLIF(TRIM(customs_supplier)"));
            assert.ok(sql.includes("LEFT JOIN billing_info"));
            assert.ok(sql.includes("ORDER BY o.serial_number DESC"));
            assert.strictEqual(sql.includes("o.serial_number LIKE ?"), Boolean(keyword));
            assert.strictEqual(sql.includes("o.company_name LIKE ?"), Boolean(companyName));
            const scopeParams = sql.includes("CAST(? AS BINARY)") ? ["FixtureCo"] : [];
            assert.deepStrictEqual(params, [
              ...scopeParams,
              ...(keyword ? [`%${keyword}%`] : []),
              ...(companyName ? [`%${companyName}%`] : []),
            ]);
            return [keyword ? rows.filter((row) => String(row.serial_number || "").includes(keyword)) : rows];
          }

          return [[]];
        },
        release() { state.releaseCount += 1; },
      };
    },
  };
}

function testCompanyFilters() {
  const filter = buildReportFilter({
    query: {
      serial_number: "202609",
      sender_company: "发件",
      receiver_company: "收件",
    },
  });
  assert.strictEqual(
    filter.whereClause,
    "WHERE o.serial_number LIKE ? AND o.sender_company LIKE ? AND o.receiver_company LIKE ?"
  );
  assert.deepStrictEqual(filter.params, ["%202609%", "%发件%", "%收件%"]);
}

function testCompanyNameFilter() {
  const filter = buildReportFilter({
    query: {
      serial_number: "202609",
      company_name: "  MainCo  ",
      sender_company: "Sender",
      receiver_company: "Receiver",
    },
  });
  assert.strictEqual(
    filter.whereClause,
    "WHERE o.serial_number LIKE ? AND o.company_name LIKE ? AND o.sender_company LIKE ? AND o.receiver_company LIKE ?"
  );
  assert.strictEqual(filter.companyName, "MainCo");
  assert.deepStrictEqual(filter.params, ["%202609%", "%MainCo%", "%Sender%", "%Receiver%"]);

  const emptyCompanyFilter = buildReportFilter({
    query: { company_name: "   " },
  });
  assert.strictEqual(emptyCompanyFilter.companyName, "");
  assert.strictEqual(emptyCompanyFilter.whereClause, "");
  assert.deepStrictEqual(emptyCompanyFilter.params, []);

  const combinedFilter = buildReportFilter({
    query: {
      serial_number: "202609",
      company_name: "MainCo",
      sender_company: "Sender",
      receiver_company: "Receiver",
      date_field: "receive_date",
      date_from: "2026-09-01",
      date_to: "2026-09-30",
    },
    orderAccess: {
      sql: () => "o.company_name IN (?)",
      params: ["AllowedCo"],
    },
  });
  assert.strictEqual(
    combinedFilter.whereClause,
    "WHERE o.company_name IN (?) AND o.receive_date >= CONCAT(?, ' 00:00:00') AND o.receive_date < DATE_ADD(?, INTERVAL 1 DAY) AND o.serial_number LIKE ? AND o.company_name LIKE ? AND o.sender_company LIKE ? AND o.receiver_company LIKE ?"
  );
  assert.deepStrictEqual(combinedFilter.params, [
    "AllowedCo",
    "2026-09-01",
    "2026-09-30",
    "%202609%",
    "%MainCo%",
    "%Sender%",
    "%Receiver%",
  ]);
}

function createUserDb(role) {
  return {
    async execute(sql, params) {
      if (sql.includes("FROM user_order_companies")) return [[{ company_name: "FixtureCo" }]];
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      return params[0] === "1" ? [[{ id: 1, role }]] : [[]];
    },
  };
}

async function requestReport(router, requestPath, headers = {}) {
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers["x-user-id"] === "1") {
      req.user = {
        id: req.headers["x-user-id"],
        role: "user",
      };
    }
    next();
  });
  app.use("/api/reports", router);
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}${requestPath}`, { headers });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function testReportEndpointsAndExcelExport() {
  const rows = [{
    serial_number: "202609007",
    company_name: "A公司",
    receive_date: "2026-09-01",
    transport_supplier: "Carrier",
    customs_port: "Shanghai",
    customs_declaration_number: "C001\nC002",
    complete_docs_send_time: "2026-09-08",
    pieces_total: 2,
    cost_items_raw: JSON.stringify([{ amount: "100" }, { amount: "20.5" }]),
    billing_items_raw: JSON.stringify([{ amount: "300" }, { amount: "20", billing_period: "2026-09" }]),
    billing_completed_time: "2026-09-30",
  }, { serial_number: "202609008", company_name: null }, { serial_number: "OTHER" }];
  const selectedFields = encodeURIComponent(JSON.stringify([
    "billing_period",
    "sales_total",
    "cost_total",
    "company_name",
    "unknown",
  ]));
  let adminSummary;
  let adminExport;
  for (const role of ["admin", "user"]) {
    const db = createReportDb(rows);
    const router = createReportsRouter(db, createUserDb(role));
    const query = `report_type=total&serial_number=202609&selected_fields=${selectedFields}`;
    const headers = { "x-user-id": "1" };
    const summaryResponse = await requestReport(router, `/api/reports/summary?${query}`, headers);
    assert.strictEqual(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.deepStrictEqual(
      Object.keys(summary).sort(),
      [
        "columns",
        "date_field",
        "date_from",
        "date_to",
        "empty_value_text",
        "report_type",
        "rows",
        "selected_fields",
        "serial_number",
      ]
    );
    assert.strictEqual(summary.report_type, "total");
    assert.strictEqual(summary.serial_number, "202609");
    assert.deepStrictEqual(summary.selected_fields, EXPECTED_FIELD_KEYS);
    assert.deepStrictEqual(
      summary.columns.map((column) => column.key),
      EXPECTED_FIELD_KEYS
    );
    assert.deepStrictEqual(summary.columns.map((column) => column.label), EXPECTED_FIELD_LABELS);
    assert.strictEqual(summary.rows.length, 2);
    assert.strictEqual(summary.rows[0].receive_date, "2026/09/01");
    assert.strictEqual(summary.rows[0].complete_docs_send_time, "2026/09/08");
    assert.strictEqual(summary.rows[0].transport_supplier, "Carrier");
    assert.strictEqual(summary.rows[0].customs_port, "Shanghai");
    assert.strictEqual(summary.rows[0].customs_declaration_number, "C001\nC002");
    assert.strictEqual(summary.rows[0].cost_total, "120.5");
    assert.strictEqual(summary.rows[0].sales_total, "320");
    assert.strictEqual(summary.rows[0].billing_period, "2026-09");
    assert.strictEqual(summary.empty_value_text, "\u8be5\u9879\u672a\u586b");
    assert.strictEqual(summary.rows[1].serial_number, "202609008");
    assert.ok(EXPECTED_FIELD_KEYS.slice(1).every((key) => summary.rows[1][key] === summary.empty_value_text));

    const exportResponse = await requestReport(router, `/api/reports/export?${query}`, headers);
    assert.strictEqual(exportResponse.status, 200);
    assert.strictEqual(
      exportResponse.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.strictEqual(exportResponse.headers.get("content-disposition"), 'attachment; filename="report_export.xlsx"');
    const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
    assert.deepStrictEqual(workbook.SheetNames, ["\u62a5\u8868"]);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const exportedRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    assert.deepStrictEqual(exportedRows[0], summary.columns.map((column) => column.label));
    assert.deepStrictEqual(exportedRows.slice(1), summary.rows.map((row) => EXPECTED_FIELD_KEYS.map((key) => row[key])));
    assert.strictEqual(db.state.connectionCount, 2);
    assert.strictEqual(db.state.releaseCount, 2);

    if (role === "admin") {
      adminSummary = summary;
      adminExport = exportedRows;
    } else {
      assert.deepStrictEqual(summary, adminSummary);
      assert.deepStrictEqual(exportedRows, adminExport);
    }

    const beforeUnauthenticated = { ...db.state };
    for (const endpoint of ["summary", "export"]) {
      for (const unauthenticatedHeaders of [{}, { "x-user-id": "999" }]) {
        const denied = await requestReport(router, `/api/reports/${endpoint}?${query}`, unauthenticatedHeaders);
        assert.strictEqual(denied.status, 401);
        assert.ok((await denied.json()).error);
      }
    }
    assert.deepStrictEqual(db.state, beforeUnauthenticated);

    for (const endpoint of ["summary", "export"]) {
      const invalid = await requestReport(router, `/api/reports/${endpoint}?report_type=unknown`, headers);
      assert.strictEqual(invalid.status, 400);
      assert.ok((await invalid.json()).error);
    }
  }
}

async function testEmptyReportsAndIgnoredLegacyParameters() {
  for (const rows of [[], [{}]]) {
    const router = createReportsRouter(createReportDb(rows, ""), createUserDb("user"));
    for (const legacyValue of ["", "[]", '["company_name"]', "sales_total,company_name", "invalid"]) {
      const query = `selected_fields=${encodeURIComponent(legacyValue)}`;
      const headers = { "x-user-id": "1" };
      const response = await requestReport(router, `/api/reports/summary?${query}`, headers);
      assert.strictEqual(response.status, 200);
      const summary = await response.json();
      assert.deepStrictEqual(summary.columns.map((column) => column.key), EXPECTED_FIELD_KEYS);
      assert.deepStrictEqual(summary.columns.map((column) => column.label), EXPECTED_FIELD_LABELS);
      assert.deepStrictEqual(summary.selected_fields, EXPECTED_FIELD_KEYS);
      const exported = await requestReport(router, `/api/reports/export?${query}`, headers);
      assert.strictEqual(exported.status, 200);
      const workbook = XLSX.read(Buffer.from(await exported.arrayBuffer()), { type: "buffer" });
      const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false });
      assert.deepStrictEqual(sheetRows, [
        EXPECTED_FIELD_LABELS,
        ...summary.rows.map((row) => EXPECTED_FIELD_KEYS.map((key) => row[key])),
      ]);
    }
  }
}

async function testCompleteExcelMapping() {
  const { input, expected } = testFieldMappingsAndFormatting();
  const router = createReportsRouter(createReportDb([input]), createUserDb("user"));
  const response = await requestReport(router, "/api/reports/export?serial_number=202609", { "x-user-id": "1" });
  assert.strictEqual(response.status, 200);
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false });
  assert.deepStrictEqual(sheetRows, [EXPECTED_FIELD_LABELS, expected]);
}

async function testDateOnlyReportExport() {
  const cases = [
    { value: new Date(2026, 9, 26, 0, 5, 6), expected: "2026/10/26" },
    { value: new Date(2026, 9, 26, 23, 59, 59), expected: "2026/10/26" },
    { value: "2026-10-26 12:34:56", expected: "2026/10/26" },
    { value: "2026-10-26T23:59:59.000+08:00", expected: "2026/10/26" },
    { value: "2026/1/2", expected: "2026/01/02" },
    { value: null, expected: "该项未填" },
    { value: undefined, expected: "该项未填" },
    { value: "", expected: "该项未填" },
    { value: new Date(NaN), expected: "该项未填" },
  ];
  const rows = cases.map(({ value }, index) => ({
    serial_number: `202609${index}`,
    ...Object.fromEntries(DATE_ONLY_FIELD_KEYS.map((key) => [key, value])),
  }));
  const originalTimes = cases.map(({ value }) => value instanceof Date ? value.getTime() : value);
  for (const role of ["admin", "user"]) {
    const router = createReportsRouter(createReportDb(rows), createUserDb(role));
    const headers = { "x-user-id": "1" };
    const query = "serial_number=202609";
    const summaryResponse = await requestReport(router, `/api/reports/summary?${query}`, headers);
    assert.strictEqual(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    const exportResponse = await requestReport(router, `/api/reports/export?${query}`, headers);
    assert.strictEqual(exportResponse.status, 200);
    const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const exportedRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
    assert.deepStrictEqual(exportedRows[0], EXPECTED_FIELD_LABELS);
    cases.forEach(({ expected }, index) => {
      DATE_ONLY_FIELD_KEYS.forEach((key) => {
        const columnIndex = EXPECTED_FIELD_KEYS.indexOf(key);
        assert.strictEqual(summary.rows[index][key], expected, `${role}: summary ${key}`);
        assert.strictEqual(exportedRows[index + 1][columnIndex], expected, `${role}: export ${key}`);
        const cell = worksheet[XLSX.utils.encode_cell({ r: index + 1, c: columnIndex })];
        assert.strictEqual(cell.t, "s");
        assert.strictEqual(cell.v, expected);
      });
    });
  }
  assert.deepStrictEqual(
    cases.map(({ value }) => value instanceof Date ? value.getTime() : value),
    originalTimes,
    "date-only formatting must not mutate source timestamps"
  );
}

async function testReportQueryErrorsReleaseConnection() {
  const db = createReportDb([], "");
  const getConnection = db.getConnection.bind(db);
  db.getConnection = async () => {
    const connection = await getConnection();
    const execute = connection.execute.bind(connection);
    connection.execute = async (sql, params) => {
      if (sql.includes("SELECT")) throw new Error("test database failure");
      return execute(sql, params);
    };
    return connection;
  };
  const router = createReportsRouter(db, createUserDb("user"));
  for (const endpoint of ["summary", "export"]) {
    const response = await requestReport(router, `/api/reports/${endpoint}`, { "x-user-id": "1" });
    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(await response.json(), { error: "test database failure" });
  }
  assert.strictEqual(db.state.connectionCount, 2);
  assert.strictEqual(db.state.releaseCount, 2);
}

async function testCompanyNameFilterOnBothEndpoints() {
  const db = createReportDb([], "202609", "ACompany");
  const router = createReportsRouter(db, createUserDb("user"));
  for (const endpoint of ["summary", "export"]) {
    const response = await requestReport(
      router,
      `/api/reports/${endpoint}?serial_number=202609&company_name=%20ACompany%20`,
      { "x-user-id": "1" }
    );
    assert.strictEqual(response.status, 200);
  }
  assert.strictEqual(db.state.connectionCount, 2);
  assert.strictEqual(db.state.releaseCount, 2);
}

async function run() {
  testUnifiedReportFieldDefinitions();
  testCompanyFilters();
  testCompanyNameFilter();
  testFrontendUsesSharedDefinition();
  await testReportEndpointsAndExcelExport();
  await testEmptyReportsAndIgnoredLegacyParameters();
  await testCompleteExcelMapping();
  await testDateOnlyReportExport();
  await testReportQueryErrorsReleaseConnection();
  await testCompanyNameFilterOnBothEndpoints();
  console.log("report_management_feature_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
