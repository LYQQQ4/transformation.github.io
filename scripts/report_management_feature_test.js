const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { buildTotalReportSummaryRows, deriveBillingPeriod } = require("../backend/lib/reporting");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function testReportSummaryFieldDedup() {
  const summary = buildTotalReportSummaryRows([
    {
      serial_number: "202607001",
      company_name: "A公司",
      orderer: "张三",
      business_type: "空运",
      customer_id: "ch001",
      sender_id: "ch002",
      billing_completed_time: "2026-07-01",
      tracking_number: "TN001",
      billing_items_raw: JSON.stringify([
        { billing_period: "2026-07" },
        { billing_period: "2026-07" },
        { billing_period: "2026-08" }
      ])
    }
  ]);

  const columnKeys = summary.columns.map((column) => column.key);
  assert.deepStrictEqual(
    columnKeys.filter((key) => key === "billing_period"),
    ["billing_period"],
    "billing period should only appear once in summary columns"
  );
  assert.strictEqual(summary.rows[0].billing_period, "2026-07 / 2026-08");
  assert.strictEqual(deriveBillingPeriod({ billing_period_raw: "2026-07" }), "2026-07");
}

function testReportManagementUiExists() {
  const html = read("frontend/index.html");
  assert.ok(html.includes('id="reportManagementLink"'), "report management menu should exist");
  assert.ok(html.includes('id="reportManagementPage"'), "report management page should exist");
  assert.ok(html.includes('id="reportTypeSelect"'), "report type selector should exist");
  assert.ok(html.includes('id="reportManagementTable"'), "report result table should exist");
}

function testFrontendHandlersExist() {
  const appJs = read("frontend/app.js");
  assert.ok(appJs.includes("function queryReports()"), "queryReports handler should exist");
  assert.ok(appJs.includes('pageName === "reportManagement"'), "showPage should handle report management");
  assert.ok(appJs.includes("getReportRequestUrl"), "report request URL builder should exist");
}

function testBackendRouteMounted() {
  const serverJs = read("backend/server.js");
  const reportsRouteJs = read("backend/routes/reports.js");

  assert.ok(serverJs.includes('app.use("/api/reports", require("./routes/reports")(pool, userPool));'));
  assert.ok(reportsRouteJs.includes('router.get("/summary"'));
  assert.ok(reportsRouteJs.includes('requireAdminAccess(userDb, req, "报表管理")'));
}

function run() {
  testReportSummaryFieldDedup();
  testReportManagementUiExists();
  testFrontendHandlersExist();
  testBackendRouteMounted();
  console.log("report_management_feature_test: ok");
}

run();
