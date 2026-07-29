const assert = require("assert");

const { buildFilledStatusSql, buildTotalReportSummaryRows, deriveBillingPeriod } = require("../backend/lib/reporting");

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

function testTotalReportSummaryDedupColumns() {
  const summary = buildTotalReportSummaryRows([
    {
      serial_number: "202607001",
      company_name: "A公司",
      orderer: "张三",
      business_type: "空运",
      customer_id: "ch001",
      sender_id: "ch002",
      billing_completed_time: "2026-07-01",
      billing_items_raw: JSON.stringify([
        { billing_period: "2026-07" },
        { billing_period: "2026-07" },
      ]),
      tracking_number: "TN001",
    },
    {
      serial_number: "202607002",
      company_name: "B公司",
      orderer: "李四",
      business_type: "海运",
      customer_id: "ch003",
      sender_id: "ch004",
      billing_completed_time: null,
      billing_items_raw: JSON.stringify([]),
      tracking_number: "",
    },
  ]);

  const columnKeys = summary.columns.map((column) => column.key);
  assert.ok(columnKeys.includes("serial_number"));
  assert.ok(columnKeys.includes("company_name"));
  assert.ok(columnKeys.includes("billing_completed_time"));
  assert.ok(columnKeys.includes("billing_period"));
  assert.ok(columnKeys.includes("tracking_number"));
  assert.strictEqual(summary.rows[0].billing_period, "2026-07");
  assert.strictEqual(summary.rows[1].billing_period, "");
}

function run() {
  testBillingPeriodDerivation();
  testFilledStatusSql();
  testTotalReportSummaryDedupColumns();
  console.log("order_management_feature_test: ok");
}

run();
