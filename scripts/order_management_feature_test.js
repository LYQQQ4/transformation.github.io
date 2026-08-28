const assert = require("assert");

const {
  REPORT_EMPTY_VALUE_TEXT,
  buildFilledStatusSql,
  buildTotalReportSummaryRows,
  deriveBillingPeriod,
} = require("../backend/lib/reporting");

function testBillingPeriodDerivation() {
  assert.strictEqual(deriveBillingPeriod({ billing_period_raw: "2026-07" }), "2026-07");
  assert.strictEqual(
    deriveBillingPeriod({
      billing_items_raw: JSON.stringify([
        { billing_period: "2026-07" },
        { billing_period: "2026-07" },
        { billing_period: "2026-08" },
      ]),
    }),
    "2026-07 / 2026-08"
  );
  assert.strictEqual(deriveBillingPeriod({ billing_items_raw: "[]" }), "");
}

function testFilledStatusSql() {
  assert.strictEqual(
    buildFilledStatusSql("b.billing_completed_time", "filled"),
    "NULLIF(TRIM(CAST(b.billing_completed_time AS CHAR)), '') IS NOT NULL"
  );
  assert.strictEqual(
    buildFilledStatusSql("b.billing_completed_time", "unfilled"),
    "NULLIF(TRIM(CAST(b.billing_completed_time AS CHAR)), '') IS NULL"
  );
  assert.strictEqual(buildFilledStatusSql("b.billing_completed_time", "all"), "");
}

function testTotalReportSummarySelectedFieldsAndEmptyText() {
  const summary = buildTotalReportSummaryRows(
    [
      {
        serial_number: "202607001",
        company_name: "A公司",
        orderer: "张三",
        business_type: "空运",
        tracking_number: "TN001",
        billing_items_raw: JSON.stringify([{ billing_period: "2026-07" }]),
      },
      {
        serial_number: "202607002",
        company_name: "",
        orderer: "李四",
        business_type: "海运",
        tracking_number: "",
        billing_items_raw: JSON.stringify([]),
      },
    ],
    {
      selectedFieldKeys: [
        "tracking_number",
        "company_name",
        "tracking_number",
        "billing_period",
      ],
    }
  );

  const columnKeys = summary.columns.map((column) => column.key);
  assert.deepStrictEqual(
    columnKeys,
    ["company_name", "tracking_number", "billing_period"],
    "selected fields should keep definition order and drop duplicates"
  );
  assert.strictEqual(summary.rows[0].billing_period, "2026-07");
  assert.strictEqual(summary.rows[1].company_name, REPORT_EMPTY_VALUE_TEXT);
  assert.strictEqual(summary.rows[1].tracking_number, REPORT_EMPTY_VALUE_TEXT);
  assert.strictEqual(summary.rows[1].billing_period, REPORT_EMPTY_VALUE_TEXT);
}

function run() {
  testBillingPeriodDerivation();
  testFilledStatusSql();
  testTotalReportSummarySelectedFieldsAndEmptyText();
  console.log("order_management_feature_test: ok");
}

run();
