const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const createBillingRouter = require("../backend/routes/billing");
const summaryFields = require("../frontend/order_summary_fields");

const appSource = fs.readFileSync(path.join(__dirname, "..", "frontend", "app.js"), "utf8");

function findGetRoute(router, routePath) {
  const layer = router.stack.find(({ route }) => route?.path === routePath && route.methods.get);
  assert.ok(layer, `Missing GET route: ${routePath}`);
  return layer.route.stack[0].handle;
}

async function testBackendFilters() {
  const queries = [];
  const db = {
    async execute(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("CREATE TABLE IF NOT EXISTS billing_info")) {
        return [[]];
      }
      if (sql.includes("information_schema.COLUMNS")) {
        return [[{ count: 1 }]];
      }
      return [[{
        serial_number: "A001",
        company_name: "  Acme Logistics  ",
        billing_completed_time: "2026-10-24",
        cost_items: null,
        billing_items: null,
      }]];
    },
  };
  const router = createBillingRouter(db);
  const getList = findGetRoute(router, "/");
  let body;
  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      body = value;
    },
  };

  await getList({
    query: {
      company_name: "  Acme  ",
      billing_completed_time_filled_status: "filled",
      cost_filled_status: "unfilled",
      sales_filled_status: "filled",
      billing_period_filled_status: "unfilled",
    },
  }, response);

  assert.equal(response.statusCode, undefined);
  assert.equal(body.records.length, 1);
  const listQuery = queries.at(-1);
  assert.deepEqual(listQuery.params, [
    "%Acme%",
  ]);
  assert.match(listQuery.sql, /o\.company_name LIKE \?/u);
  assert.match(listQuery.sql, /NULLIF\(TRIM\(CAST\(b\.billing_completed_time AS CHAR\)\), ''\) IS NOT NULL/u);
  assert.match(listQuery.sql, /NULLIF\(TRIM\(CAST\(b\.cost_items AS CHAR\)\), ''\) IS NULL/u);
  assert.match(listQuery.sql, /NULLIF\(TRIM\(CAST\(b\.billing_items AS CHAR\)\), ''\) IS NOT NULL/u);
  assert.match(listQuery.sql, /COALESCE\(NULLIF\(TRIM\(CAST\(b\.billing_items AS CHAR\)\), ''\), NULLIF\(TRIM\(CAST\(t\.billing_period AS CHAR\)\), ''\)\) AS CHAR\)\), ''\) IS NULL/u);
  assert.ok(!listQuery.sql.includes("Acme"));

}

function createFrontendContext() {
  const values = new Map([
    ["billingFilterCompanyName", { value: "" }],
    ["billingFilterCompletedStatus", { value: "all" }],
    ["billingFilterCostStatus", { value: "all" }],
    ["billingFilterSalesStatus", { value: "all" }],
    ["billingFilterPeriodStatus", { value: "all" }],
  ]);
  const loads = [];
  const context = vm.createContext({
    console,
    URLSearchParams,
    tablePaginationStates: new Map([["billingTable", { page: 4 }]]),
    loadBillingRecords: async () => loads.push("load"),
    document: {
      getElementById(id) {
        return values.get(id) || null;
      },
    },
  });
  const stateStart = appSource.indexOf("const billingFilterState =");
  const stateEnd = appSource.indexOf("const ORDER_SUMMARY_FIELD_API", stateStart);
  vm.runInContext(appSource.slice(stateStart, stateEnd), context);
  const functionStart = appSource.indexOf("function syncBillingFilterControls()");
  const functionEnd = appSource.indexOf("async function loadBillingRecords", functionStart);
  vm.runInContext(appSource.slice(functionStart, functionEnd), context);
  return { context, values, loads };
}

async function testFrontendFilters() {
  const { context, values, loads } = createFrontendContext();
  values.get("billingFilterCompanyName").value = "  Acme  ";
  values.get("billingFilterCompletedStatus").value = "filled";
  values.get("billingFilterCostStatus").value = "unfilled";
  values.get("billingFilterSalesStatus").value = "filled";
  values.get("billingFilterPeriodStatus").value = "unfilled";

  await context.applyBillingFilters();
  assert.equal(await context.buildBillingFilterQuery(), "company_name=Acme&billing_completed_time_filled_status=filled&cost_filled_status=unfilled&sales_filled_status=filled&billing_period_filled_status=unfilled");
  assert.deepEqual(loads, ["load"]);
  assert.equal(context.tablePaginationStates.get("billingTable").page, 1);

  await context.clearBillingFilters();
  assert.equal(context.buildBillingFilterQuery(), "");
  assert.deepEqual(loads, ["load", "load"]);
  assert.equal(values.get("billingFilterCompanyName").value, "");
  assert.equal(values.get("billingFilterCompletedStatus").value, "all");
}

function testBillingEmptyValues() {
  ["", " ", null, undefined].forEach((value) => {
    const record = {
      cost_items: value,
      billing_items: value,
    };
    assert.equal(summaryFields.getOrderSummaryFieldValue(record, "cost_total"), "");
    assert.equal(summaryFields.getOrderSummaryFieldValue(record, "sales_total"), "");
    assert.equal(summaryFields.getOrderSummaryFieldValue(record, "billing_period"), "");
  });
  assert.match(appSource, /暂无符合条件的账单数据/u);
}

async function run() {
  await testBackendFilters();
  await testFrontendFilters();
  testBillingEmptyValues();
  console.log("billing_filter_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
