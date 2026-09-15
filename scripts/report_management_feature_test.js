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
  return {
    async execute(sql, params = []) {
      if (sql.includes("SHOW TABLES LIKE 'package'")) {
        return [[{ Tables_in_order_system: "package" }]];
      }
      if (sql.includes("FROM INFORMATION_SCHEMA.COLUMNS")) {
        return [[{ Field: params[0] }]];
      }
      return [[]];
    },
    async getConnection() {
      return {
        async execute(sql) {
          if (sql.includes("SET SESSION group_concat_max_len")) {
            return [[]];
          }
          if (sql.includes("SELECT")) {
            return [rows];
          }
          return [[]];
        },
        release() {},
      };
    },
  };
}

function createUserDb(role) {
  return {
    async execute() {
      return [[{ id: 1, role }]];
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
  }];
  const router = createReportsRouter(createReportDb(rows), createUserDb("admin"));
  const selectedFields = encodeURIComponent(JSON.stringify([
    "billing_period",
    "sales_total",
    "cost_total",
    "company_name",
    "unknown",
  ]));
  const headers = { "x-user-id": "1" };

  const summaryResponse = await requestReport(
    router,
    `/api/reports/summary?report_type=total&selected_fields=${selectedFields}`,
    headers
  );
  assert.strictEqual(summaryResponse.status, 200);
  const summary = await summaryResponse.json();
  assert.deepStrictEqual(
    summary.columns.map((column) => column.key),
    ["company_name", "cost_total", "sales_total", "billing_period"]
  );
  assert.strictEqual(summary.rows[0].cost_total, "120.5");
  assert.strictEqual(summary.rows[0].sales_total, "320");
  assert.strictEqual(summary.rows[0].billing_period, "2026-09");

  const exportResponse = await requestReport(
    router,
    `/api/reports/export?report_type=total&selected_fields=${selectedFields}`,
    headers
  );
  assert.strictEqual(exportResponse.status, 200);
  const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const exportedRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  assert.deepStrictEqual(
    exportedRows[0],
    summary.columns.map((column) => column.label)
  );
  assert.deepStrictEqual(exportedRows[1], ["A公司", "120.5", "320", "2026-09"]);

  const deniedResponse = await requestReport(
    createReportsRouter(createReportDb(rows), createUserDb("user")),
    "/api/reports/summary?report_type=total",
    headers
  );
  assert.strictEqual(deniedResponse.status, 403);
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
