const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  REPORT_EMPTY_VALUE_TEXT,
  buildTotalReportSummaryRows,
  deriveBillingPeriod,
} = require("../backend/lib/reporting");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function testReportSummaryFieldDedup() {
  const summary = buildTotalReportSummaryRows(
    [
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
          { billing_period: "2026-08" },
        ]),
      },
    ],
    {
      selectedFieldKeys: ["billing_period", "tracking_number", "billing_period"],
    }
  );

  const columnKeys = summary.columns.map((column) => column.key);
  assert.deepStrictEqual(columnKeys, ["tracking_number", "billing_period"]);
  assert.strictEqual(summary.rows[0].billing_period, "2026-07 / 2026-08");
  assert.strictEqual(deriveBillingPeriod({ billing_period_raw: "2026-07" }), "2026-07");
}

function testReportSummaryEmptyText() {
  const summary = buildTotalReportSummaryRows(
    [
      {
        serial_number: "202607001",
        company_name: "",
      },
    ],
    {
      selectedFieldKeys: ["company_name"],
    }
  );

  assert.strictEqual(summary.rows[0].company_name, REPORT_EMPTY_VALUE_TEXT);
}

function testReportManagementUiExists() {
  const html = read("frontend/index.html");
  assert.ok(html.includes('id="reportManagementLink"'), "report management menu should exist");
  assert.ok(html.includes('id="reportManagementPage"'), "report management page should exist");
  assert.ok(html.includes('id="reportTypeSelect"'), "report type selector should exist");
  assert.ok(html.includes('id="reportManagementTable"'), "report result table should exist");
  assert.ok(html.includes('onclick="exportReports()"'), "report export button should exist");
}

function testFrontendHandlersExist() {
  const appJs = read("frontend/app.js");
  const userProfilesJs = read("frontend/user_profiles.js");

  assert.ok(appJs.includes("function queryReports()"), "queryReports handler should exist");
  assert.ok(appJs.includes("function exportReports()"), "exportReports handler should exist");
  assert.ok(appJs.includes("ensureReportManagementFieldSelector"), "field selector renderer should exist");
  assert.ok(appJs.includes("appendSelectedReportFields"), "selected field query builder should exist");
  assert.ok(appJs.includes('params.set("selected_fields"'), "selected fields should be sent to backend");
  assert.ok(appJs.includes("REPORT_EMPTY_VALUE_TEXT"), "empty-value text constant should exist");
  assert.ok(appJs.includes('pageName === "reportManagement"'), "showPage should handle report management");
  assert.ok(!userProfilesJs.includes("company.value = profile.company_name"), "customer ID changes must not fill company title");
}

function testBackendRouteMounted() {
  const serverJs = read("backend/server.js");
  const reportsRouteJs = read("backend/routes/reports.js");

  assert.ok(serverJs.includes('app.use("/api/reports", require("./routes/reports")(pool, userPool));'));
  assert.ok(reportsRouteJs.includes('router.get("/summary"'));
  assert.ok(reportsRouteJs.includes('router.get("/export"'));
  assert.ok(reportsRouteJs.includes("parseSelectedReportFields"), "selected field parser should exist");
  assert.ok(reportsRouteJs.includes("selected_fields"), "routes should pass selected fields through");
  assert.ok(reportsRouteJs.includes("XLSX.utils.aoa_to_sheet"));
}

function run() {
  testReportSummaryFieldDedup();
  testReportSummaryEmptyText();
  testReportManagementUiExists();
  testFrontendHandlersExist();
  testBackendRouteMounted();
  console.log("report_management_feature_test: ok");
}

run();
