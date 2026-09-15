const assert = require("assert");

const orderSummaryFields = require("../frontend/order_summary_fields");
const {
  REPORT_EMPTY_VALUE_TEXT,
  buildFilledStatusSql,
  buildTotalReportSummaryRows,
  deriveBillingPeriod,
} = require("../backend/lib/reporting");

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

function testOrderSummaryFieldDefinitions() {
  assert.deepStrictEqual(
    orderSummaryFields.ORDER_SUMMARY_FIELD_DEFINITIONS.map((field) => field.key),
    EXPECTED_FIELD_KEYS
  );
  assert.strictEqual(orderSummaryFields.ORDER_SUMMARY_FIELD_DEFINITIONS[5].label, "收件人ID");
}

function testOrderSummaryTotalsAndFormatting() {
  const record = orderSummaryFields.enrichOrderSummaryFields({
    serial_number: "202609001",
    receive_date: "2026-09-01",
    cost_items_raw: JSON.stringify([{ amount: "100.25" }, { amount: "20" }, { amount: "invalid" }]),
    billing_items_raw: JSON.stringify([
      { amount: "200.5", billing_period: "2026-09" },
      { amount: "99.5", billing_period: "2026-10" },
    ]),
  });

  assert.strictEqual(record.cost_total, "120.25");
  assert.strictEqual(record.sales_total, "300");
  assert.strictEqual(record.billing_period, "2026-09 / 2026-10");
  assert.strictEqual(orderSummaryFields.formatOrderSummaryValue("receive_date", record.receive_date), "2026/09/01");
  assert.strictEqual(orderSummaryFields.formatOrderSummaryValue("company_name", ""), "该项未填");
}

function testTotalReportSummarySelectedFieldsAndEmptyText() {
  const summary = buildTotalReportSummaryRows(
    [{
      serial_number: "202607001",
      company_name: "A公司",
      tracking_number: "TN001",
      cost_items_raw: JSON.stringify([{ amount: "10" }]),
      billing_items_raw: JSON.stringify([{ amount: "20", billing_period: "2026-07" }]),
    }],
    {
      selectedFieldKeys: ["sales_total", "company_name", "unknown", "cost_total", "sales_total"],
    }
  );

  assert.deepStrictEqual(
    summary.columns.map((column) => column.key),
    ["company_name", "cost_total", "sales_total"]
  );
  assert.strictEqual(summary.rows[0].cost_total, "10");
  assert.strictEqual(summary.rows[0].sales_total, "20");

  const emptySummary = buildTotalReportSummaryRows(
    [{ serial_number: "202607002" }],
    { selectedFieldKeys: ["company_name", "cost_total", "sales_total", "billing_period"] }
  );
  emptySummary.columns.forEach((column) => {
    assert.strictEqual(emptySummary.rows[0][column.key], REPORT_EMPTY_VALUE_TEXT);
  });
}

function run() {
  testBillingPeriodDerivation();
  testFilledStatusSql();
  testOrderSummaryFieldDefinitions();
  testOrderSummaryTotalsAndFormatting();
  testTotalReportSummarySelectedFieldsAndEmptyText();
  console.log("order_management_feature_test: ok");
}

run();
