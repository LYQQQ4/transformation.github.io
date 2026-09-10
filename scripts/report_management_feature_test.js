const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const XLSX = require("xlsx");

const {
  combineTrackingRemarks,
  REPORT_EMPTY_VALUE_TEXT,
  TOTAL_REPORT_FIELD_DEFINITIONS,
  buildTotalReportSummaryRows,
  deriveBillingPeriod,
} = require("../backend/lib/reporting");
const createReportsRouter = require("../backend/routes/reports");

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

function testUnifiedRemarkFieldDefinitions() {
  const keys = TOTAL_REPORT_FIELD_DEFINITIONS.map((field) => field.key);
  const outputKeys = TOTAL_REPORT_FIELD_DEFINITIONS.map((field) => field.outputKey);

  ["remark1", "remark2", "cargo_flow_info", "value_added_services"].forEach((key) => {
    assert.ok(keys.includes(key), `report field definition should include ${key}`);
  });

  [
    "pickup_remark1",
    "pickup_remark2",
    "transfer_remark1",
    "transfer_remark2",
    "customs_remark1",
    "customs_remark2",
  ].forEach((key) => {
    assert.ok(!keys.includes(key), `report field definition should not include ${key}`);
  });

  assert.strictEqual(new Set(keys).size, keys.length, "report field keys must be unique");
  assert.strictEqual(new Set(outputKeys).size, outputKeys.length, "report output keys must be unique");
}

function testCombineTrackingRemarks() {
  assert.strictEqual(
    combineTrackingRemarks({ pickup_remark1_source: "pickup only" }, 1),
    "pickup only"
  );
  assert.strictEqual(
    combineTrackingRemarks({ transfer_remark1_source: "transfer only" }, 1),
    "transfer only"
  );
  assert.strictEqual(
    combineTrackingRemarks({ customs_remark1_source: "customs only" }, 1),
    "customs only"
  );
  assert.strictEqual(
    combineTrackingRemarks(
      {
        pickup_remark1_source: "pick",
        transfer_remark1_source: "send",
        customs_remark1_source: "clear",
      },
      1
    ),
    "提货备注：pick\n送货备注：send\n报关备注：clear"
  );
  assert.strictEqual(
    combineTrackingRemarks(
      {
        pickup_remark2_source: "same",
        transfer_remark2_source: "same",
        customs_remark2_source: "other",
      },
      2
    ),
    "提货备注：same\n报关备注：other"
  );
  assert.strictEqual(
    combineTrackingRemarks(
      {
        pickup_remark1_source: "   ",
        transfer_remark1_source: null,
        customs_remark1_source: undefined,
      },
      1
    ),
    ""
  );
}

function testUnifiedRemarkSummaryValues() {
  const pickupOnly = buildTotalReportSummaryRows(
    [{ serial_number: "202609001", pickup_remark1_source: "pickup remark" }],
    { selectedFieldKeys: ["remark1"] }
  );
  assert.deepStrictEqual(pickupOnly.columns.map((column) => column.key), ["remark1"]);
  assert.strictEqual(pickupOnly.rows[0].remark1, "pickup remark");

  const transferOnly = buildTotalReportSummaryRows(
    [{ serial_number: "202609002", transfer_remark1_source: "transfer remark" }],
    { selectedFieldKeys: ["remark1"] }
  );
  assert.strictEqual(transferOnly.rows[0].remark1, "transfer remark");

  const customsOnly = buildTotalReportSummaryRows(
    [{ serial_number: "202609003", customs_remark2_source: "customs remark" }],
    { selectedFieldKeys: ["remark2"] }
  );
  assert.deepStrictEqual(customsOnly.columns.map((column) => column.key), ["remark2"]);
  assert.strictEqual(customsOnly.rows[0].remark2, "customs remark");

  const mixed = buildTotalReportSummaryRows(
    [{
      serial_number: "202609004",
      pickup_remark1_source: "pickup remark",
      transfer_remark1_source: "transfer remark",
      customs_remark1_source: "customs remark",
      cargo_flow_info: "pickup flow\nsecond line",
      value_added_services: "value added service",
    }],
    {
      selectedFieldKeys: [
        "remark1",
        "remark1",
        "cargo_flow_info",
        "value_added_services",
      ],
    }
  );

  assert.deepStrictEqual(
    mixed.columns.map((column) => column.key),
    ["cargo_flow_info", "value_added_services", "remark1"]
  );
  assert.strictEqual(mixed.rows[0].cargo_flow_info, "pickup flow\nsecond line");
  assert.strictEqual(
    mixed.rows[0].remark1,
    "提货备注：pickup remark\n送货备注：transfer remark\n报关备注：customs remark"
  );

  const duplicate = buildTotalReportSummaryRows(
    [{
      serial_number: "202609005",
      pickup_remark2_source: "same value",
      transfer_remark2_source: "same value",
      customs_remark2_source: "different value",
    }],
    {
      selectedFieldKeys: ["remark2", "remark2"],
    }
  );
  assert.deepStrictEqual(duplicate.columns.map((column) => column.key), ["remark2"]);
  assert.strictEqual(duplicate.rows[0].remark2, "提货备注：same value\n报关备注：different value");

  const emptyValues = buildTotalReportSummaryRows(
    [{
      serial_number: "202609006",
      cargo_flow_info: "",
      value_added_services: null,
      pickup_remark1_source: " ",
      transfer_remark1_source: undefined,
      customs_remark1_source: "",
    }],
    { selectedFieldKeys: ["cargo_flow_info", "value_added_services", "remark1"] }
  );

  emptyValues.columns.forEach((column) => {
    assert.strictEqual(emptyValues.rows[0][column.key], REPORT_EMPTY_VALUE_TEXT);
  });
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
  assert.ok(appJs.includes('key: "remark1"'), "field selector should include unified remark1");
  assert.ok(appJs.includes('key: "remark2"'), "field selector should include unified remark2");
  assert.ok(!appJs.includes('key: "pickup_remark1"'), "field selector should not include pickup remark1");
  assert.ok(!appJs.includes('key: "transfer_remark1"'), "field selector should not include transfer remark1");
  assert.ok(!appJs.includes('key: "customs_remark1"'), "field selector should not include customs remark1");
  assert.ok(
    appJs.includes('<textarea id="transferValueAddedServices"></textarea>'),
    "delivery tracking form should display value-added-services input"
  );
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
  assert.ok(reportsRouteJs.includes("o.remark1 AS order_remark1"));
  assert.ok(reportsRouteJs.includes("pt.remark1 AS pickup_remark1_source"));
  assert.ok(reportsRouteJs.includes("t.remark1 AS transfer_remark1_source"));
  assert.ok(reportsRouteJs.includes("c.remark1 AS customs_remark1_source"));
  assert.ok(reportsRouteJs.includes("GROUP_CONCAT(NULLIF(TRIM(remark1), '')"));
  assert.ok(reportsRouteJs.includes("FROM customs_clearance_tracking"));
  assert.ok(reportsRouteJs.includes("GROUP BY serial_number"));
  assert.ok(reportsRouteJs.includes("group_concat_max_len"));
  assert.ok(reportsRouteJs.includes("NULLIF(TRIM(pt.cargo_flow_info), '')"));
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
      if (sql.includes("ALTER TABLE `package`")) {
        return [[]];
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
    pickup_remark1_source: "pickup remark",
    transfer_remark1_source: "transfer remark",
    customs_remark1_source: "customs remark",
    pickup_remark2_source: "same note",
    transfer_remark2_source: "same note",
    customs_remark2_source: "customs note",
    cargo_flow_info: "pickup flow\nsecond line",
    value_added_services: "value added\nsecond line",
    package_remark1: "package first\npackage second",
  }];
  const router = createReportsRouter(createReportDb(rows), createUserDb("admin"));
  const selectedFields = encodeURIComponent(JSON.stringify([
    "remark1",
    "remark1",
    "remark2",
    "cargo_flow_info",
    "value_added_services",
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
    ["cargo_flow_info", "value_added_services", "remark1", "remark2"]
  );
  assert.strictEqual(
    summary.rows[0].remark1,
    "提货备注：pickup remark\n送货备注：transfer remark\n报关备注：customs remark"
  );
  assert.strictEqual(
    summary.rows[0].remark2,
    "提货备注：same note\n报关备注：customs note"
  );
  assert.strictEqual(summary.rows[0].cargo_flow_info, "pickup flow\nsecond line");
  assert.strictEqual(summary.rows[0].value_added_services, "value added\nsecond line");

  const exportResponse = await requestReport(
    router,
    `/api/reports/export?report_type=total&selected_fields=${selectedFields}`,
    headers
  );
  assert.strictEqual(exportResponse.status, 200);
  const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const exportedRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  assert.deepStrictEqual(exportedRows[0], ["货物流转信息", "增值服务备注", "备注1", "备注2"]);
  assert.strictEqual(exportedRows[1][0], "pickup flow\nsecond line");
  assert.strictEqual(exportedRows[1][1], "value added\nsecond line");
  assert.strictEqual(exportedRows[1][2], summary.rows[0].remark1);
  assert.strictEqual(exportedRows[1][3], summary.rows[0].remark2);

  const deniedResponse = await requestReport(
    createReportsRouter(createReportDb(rows), createUserDb("user")),
    "/api/reports/summary?report_type=total",
    headers
  );
  assert.strictEqual(deniedResponse.status, 403, "non-admin report access must be rejected");
}

async function run() {
  testReportSummaryFieldDedup();
  testReportSummaryEmptyText();
  testUnifiedRemarkFieldDefinitions();
  testCombineTrackingRemarks();
  testUnifiedRemarkSummaryValues();
  testReportManagementUiExists();
  testFrontendHandlersExist();
  testBackendRouteMounted();
  await testReportEndpointsAndExcelExport();
  console.log("report_management_feature_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
