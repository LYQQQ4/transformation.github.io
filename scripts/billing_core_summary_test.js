const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const orderSummaryFields = require("../frontend/order_summary_fields");
const billingFormula = require("../frontend/billing_formula");

function normalizeItems(items) {
  return billingFormula.normalizeBillingItems(items, "legacy", (nextItems) => nextItems);
}

function testCostAndSalesAggregation() {
  const record = orderSummaryFields.enrichOrderSummaryFields({
    cost_items: normalizeItems([
      { category: "成本 A", amount: "100 + 0.25" },
      { category: "成本 B", amount: "-0.25" },
      { category: "成本 C", amount: "无效金额" },
    ]),
    billing_items: normalizeItems([
      { category: "销售 A", amount: "0.1 + 0.2" },
      { category: "销售 B", amount: "200 / 2" },
      { category: "销售 C", amount: "" },
    ]),
  });

  assert.strictEqual(record.cost_total, "100");
  assert.strictEqual(record.sales_total, "100.3");
  assert.strictEqual(orderSummaryFields.formatOrderSummaryValue("cost_total", record.cost_total), "100");
  assert.strictEqual(orderSummaryFields.formatOrderSummaryValue("sales_total", record.sales_total), "100.3");
}

function testZeroAndEmptyAmounts() {
  const zeroRecord = orderSummaryFields.enrichOrderSummaryFields({
    cost_items: [{ amount: "0" }],
    billing_items: [{ amount: "0.00" }],
  });
  assert.strictEqual(zeroRecord.cost_total, "0");
  assert.strictEqual(zeroRecord.sales_total, "0");

  const emptyRecord = orderSummaryFields.enrichOrderSummaryFields({
    cost_items: [{ amount: "" }, { amount: "not-a-number" }],
    billing_items: [],
  });
  assert.strictEqual(emptyRecord.cost_total, "");
  assert.strictEqual(emptyRecord.sales_total, "");
}

function testRepeatedCalculationDoesNotAccumulate() {
  const record = {
    cost_items: [{ amount: "10" }, { amount: "2.5" }],
    billing_items: [{ amount: "25" }, { amount: "0" }],
  };
  const first = orderSummaryFields.enrichOrderSummaryFields(record);
  const second = orderSummaryFields.enrichOrderSummaryFields(first);
  assert.strictEqual(first.cost_total, "12.5");
  assert.strictEqual(first.sales_total, "25");
  assert.strictEqual(second.cost_total, "12.5");
  assert.strictEqual(second.sales_total, "25");
}

function testCoreBillingPresentation() {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "frontend", "app.js"), "utf8");
  const structureStart = appSource.indexOf("function ensureBillingPageStructure()");
  const structureEnd = appSource.indexOf("function ensureOrderBillingSection()", structureStart);
  const structureSource = appSource.slice(structureStart, structureEnd);
  assert.ok(structureSource.includes("<th>流水号</th>"));
  assert.ok(structureSource.includes("<th>公司名称</th>"));
  assert.ok(!structureSource.includes("<th>费用类别</th>"));

  const tableStart = appSource.indexOf("function syncBillingTableColumns()");
  const tableEnd = appSource.indexOf("function buildBillingBaseInfoItems(", tableStart);
  const tableSource = appSource.slice(tableStart, tableEnd);
  assert.ok(tableSource.includes("getOrderSummaryFieldDefinitions()"));
  assert.ok(tableSource.includes("showBillingDetail("));

  const renderStart = appSource.indexOf("function renderBillingDetail(");
  const renderEnd = appSource.indexOf("function getSharedTrackingFieldValue(", renderStart);
  const renderSource = appSource.slice(renderStart, renderEnd);
  assert.ok(renderSource.includes("buildBillingBaseInfoItems("));
  assert.ok(!renderSource.includes("showBillingFeeModal("));
  assert.ok(!renderSource.includes("saveBillingRecord("));

  const normalizeStart = appSource.indexOf("function normalizeBillingRecord(");
  const normalizeEnd = appSource.indexOf("function legacyTemplateBuildBillingBaseInfoItems(", normalizeStart);
  const normalizeSource = appSource.slice(normalizeStart, normalizeEnd);
  assert.ok(normalizeSource.includes("cost_total: record?.cost_total"));
  assert.ok(normalizeSource.includes("sales_total: record?.sales_total"));

  const header = {};
  const container = { dataset: {} };
  const context = vm.createContext({
    BILLING_TEMPLATE_FALLBACK_KEY: "legacy",
    getOrderSummaryFieldDefinitions: () => orderSummaryFields.ORDER_SUMMARY_FIELD_DEFINITIONS,
    getOrderSummaryFieldValue: orderSummaryFields.getOrderSummaryFieldValue,
    formatOrderSummaryFieldValue: orderSummaryFields.formatOrderSummaryValue,
    escapeHtml: (value) => String(value),
    normalizeBillingRecord: (record) => record,
    buildOrderSummaryDetailItems: (record) => orderSummaryFields.ORDER_SUMMARY_FIELD_DEFINITIONS.map((field) => [
      field.label,
      orderSummaryFields.formatOrderSummaryValue(field.key, field.getValue(record)),
    ]),
    buildDetailGridItems: (items) => JSON.stringify(items),
    document: { querySelector: () => header },
  });
  const functionsEnd = appSource.indexOf("function getSharedTrackingFieldValue(", tableStart);
  vm.runInContext(appSource.slice(tableStart, functionsEnd), context);
  context.syncBillingTableColumns();
  assert.strictEqual((header.innerHTML.match(/<th>/g) || []).length, 17);
  assert.ok(header.innerHTML.includes("<th>成本</th>"));
  assert.ok(header.innerHTML.includes("<th>销售</th>"));
  const record = { serial_number: "A001", company_name: "Company", cost_total: 0, sales_total: "100.3" };
  const row = context.buildBillingRecordRow(record);
  assert.strictEqual((row.match(/<td>/g) || []).length, 17);
  assert.ok(row.includes("showBillingDetail('A001')"));
  assert.ok(row.includes("<td>Company</td>"));
  assert.ok(row.includes("<td>0</td>"));
  assert.ok(row.includes("<td>100.3</td>"));
  context.renderBillingDetail(container, record, { editable: true, containerId: "billingPage" });
  assert.ok(container.innerHTML.includes("Company"));
  assert.ok(container.innerHTML.includes("成本"));
  assert.ok(container.innerHTML.includes("销售"));
  assert.ok(!container.innerHTML.includes("<button"));
  assert.ok(!container.innerHTML.includes("<input"));
}

function run() {
  testCostAndSalesAggregation();
  testZeroAndEmptyAmounts();
  testRepeatedCalculationDoesNotAccumulate();
  testCoreBillingPresentation();
  console.log("billing_core_summary_test: ok");
}

run();
