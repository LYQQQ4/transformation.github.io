const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const XLSX = require("xlsx");

const orderSummaryFields = require("../frontend/order_summary_fields");
const {
  TOTAL_REPORT_FIELD_DEFINITIONS,
  buildTotalReportSummaryRows,
} = require("../backend/lib/reporting");
const createReportsRouter = require("../backend/routes/reports");

const EXPECTED_FIELD_KEYS = [
  "serial_number",
  "company_name",
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
  "pieces_total",
  "cost_total",
  "sales_total",
  "billing_period",
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
    orderSummaryFields.ORDER_SUMMARY_FIELD_DEFINITIONS,
    "reporting must consume the shared order summary definition"
  );

  const summary = buildTotalReportSummaryRows(
    [{
      serial_number: "202609001",
      company_name: "A公司",
      cost_items_raw: JSON.stringify([{ amount: "100" }]),
      billing_items_raw: JSON.stringify([{ amount: "200", billing_period: "2026-09" }]),
    }],
    { selectedFieldKeys: ["sales_total", "company_name", "cost_total", "unknown"] }
  );
  assert.deepStrictEqual(
    summary.columns.map((column) => column.key),
    ["company_name", "cost_total", "sales_total"]
  );
}

function testFrontendUsesSharedDefinition() {
  const html = read("frontend/index.html");
  const appJs = read("frontend/app.js");

  assert.ok(html.includes('src="order_summary_fields.js"'));
  assert.ok(appJs.includes("ORDER_SUMMARY_FIELD_API"));
  assert.ok(appJs.includes("getOrderSummaryFieldDefinitions"));
  assert.ok(appJs.includes("buildOrderSummaryDetailItems"));
  assert.ok(appJs.includes("syncBillingTableColumns"));
}

function createReportDb(rows) {
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
            assert.ok(sql.includes("WHERE o.serial_number LIKE ?"));
            assert.deepStrictEqual(params, ["%202609%"]);
            return [rows];
          }
          return [[]];
        },
        release() { state.releaseCount += 1; },
      };
    },
  };
}

function createUserDb(role) {
  return {
    async execute(sql, params) {
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      return params[0] === "1" ? [[{ id: 1, role }]] : [[]];
    },
  };
}

async function requestReport(router, requestPath, headers = {}) {
  const app = express();
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
    pieces_total: 2,
    cost_items_raw: JSON.stringify([{ amount: "100" }, { amount: "20.5" }]),
    billing_items_raw: JSON.stringify([{ amount: "300" }, { amount: "20", billing_period: "2026-09" }]),
    billing_completed_time: "2026-09-30",
  }, { serial_number: "202609008", company_name: null }];
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
      ["columns", "empty_value_text", "report_type", "rows", "selected_fields", "serial_number"]
    );
    assert.strictEqual(summary.report_type, "total");
    assert.strictEqual(summary.serial_number, "202609");
    assert.deepStrictEqual(summary.selected_fields, [
      "billing_period", "sales_total", "cost_total", "company_name",
    ]);
    assert.deepStrictEqual(
      summary.columns.map((column) => column.key),
      ["company_name", "cost_total", "sales_total", "billing_period"]
    );
    assert.strictEqual(summary.rows[0].cost_total, "120.5");
    assert.strictEqual(summary.rows[0].sales_total, "320");
    assert.strictEqual(summary.rows[0].billing_period, "2026-09");
    assert.strictEqual(summary.empty_value_text, "\u8be5\u9879\u672a\u586b");
    assert.ok(Object.values(summary.rows[1]).every((value) => value === summary.empty_value_text));

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
    assert.deepStrictEqual(exportedRows[1], ["A公司", "120.5", "320", "2026-09"]);
    assert.deepStrictEqual(exportedRows[2], Array(4).fill(summary.empty_value_text));
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

async function run() {
  testUnifiedReportFieldDefinitions();
  testFrontendUsesSharedDefinition();
  await testReportEndpointsAndExcelExport();
  console.log("report_management_feature_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
