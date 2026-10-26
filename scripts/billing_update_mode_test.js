const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const summaryFields = require("../frontend/order_summary_fields");
const billingFormula = require("../frontend/billing_formula");
const billingTemplates = require("../frontend/billing_templates");
const createBillingRouter = require("../backend/routes/billing");

const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "app.js"), "utf8");

function createContext() {
  const elements = new Map();
  const container = {
    dataset: {
      serialNumber: "A001",
      renderOptions: JSON.stringify({ editable: true }),
      billingRecordJson: JSON.stringify({ serial_number: "A001" }),
    },
  };
  elements.set("billingDetailContainer", container);
  const state = { requests: [], messages: [], refreshes: [], records: new Map() };
  state.records.set("A001", {
    serial_number: "A001",
    billing_template_key: "legacy",
    billing_completed_time: "2026-10-01",
    cost_total: "0",
    sales_total: "12.5",
    cost_items: [{ category: "Historical cost", amount: "0", remark: "kept" }],
    billing_items: [{
      category: "Historical sales",
      amount: "12.5",
      billing_period: "2026-09",
      supplier: "kept",
    }],
  });
  state.records.set("A002", {
    ...structuredClone(state.records.get("A001")),
    serial_number: "A002",
  });

  function createModal() {
    const modal = {
      dataset: {},
      style: {},
      controls: [],
      markup: "",
      remove() { elements.delete(modal.id); },
      querySelector(selector) {
        if (selector === '[role="status"]') {
          return { remove() { modal.loadingRemoved = true; } };
        }
        if (selector === ".modal-content") {
          return {
            insertAdjacentHTML(position, html) {
              assert.equal(position, "beforeend");
              modal.markup += html;
              const serial = { value: "A002", readOnly: true };
              const completed = { value: "2026-10-01" };
              const cost = { value: "0", disabled: false };
              const sales = { value: "12.5", disabled: false };
              const period = { value: "2026-09", disabled: false };
              const saveButton = { textContent: "保存", disabled: false };
              modal.controls.push(serial, completed, cost, sales, period, saveButton);
              modal.fields = {
                "#billingSerialNumber": serial,
                "#billingCompletedTime_billingPage": completed,
                "#billingCostResult": cost,
                "#billingSalesResult": sales,
                "#billingPeriodResult": period,
                '[data-billing-save="true"]': saveButton,
              };
              modal.form = {
                reportValidity: () => state.valid !== false,
                querySelector: (key) => modal.fields[key] || null,
              };
            },
          };
        }
        if (selector === '[data-billing-fee-editors="true"]') {
          return { set innerHTML(value) { modal.editorsHtml = value; } };
        }
        if (selector === "form") {
          return modal.form || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'input[data-billing-formula-enabled="true"]') {
          return [modal.fields?.["#billingCostResult"], modal.fields?.["#billingSalesResult"]].filter(Boolean);
        }
        return modal.controls || [];
      },
    };
    return modal;
  }

  const context = vm.createContext({
    API_BASE: "/api",
    window: { BillingTemplates: billingTemplates, OrderSummaryFields: summaryFields },
    BILLING_TEMPLATE_API: billingTemplates,
    BILLING_FORMULA_API: billingFormula,
    BILLING_TEMPLATE_FALLBACK_KEY: "legacy",
    currentBillingSerialNumber: "A001",
    currentOrderDetailSerial: "A002",
    currentOrderBillingData: null,
    document: {
      getElementById: (id) => elements.get(id),
      createElement: createModal,
      body: { appendChild: (modal) => elements.set(modal.id, modal) },
    },
    fetchBillingRecordBySerial: async (serial) => {
      if (state.load) {
        return state.load(serial);
      }
      if (state.loadError) {
        throw new Error("Load failed");
      }
      return structuredClone(state.records.get(serial));
    },
    escapeHtml: (value) => String(value ?? ""),
    getOrderSummaryFieldValue: summaryFields.getOrderSummaryFieldValue,
    formatOrderSummaryFieldValue: summaryFields.formatOrderSummaryValue,
    bindBillingFormulaInputs: () => {},
    validateBillingFormulaInputs: () => true,
    normalizeBillingComputedFieldValue: (field, value) => billingFormula.normalizeBillingFieldValue(field, value),
    normalizeBillingRecord: (record) => ({
      ...record,
      cost_total: summaryFields.sumFeeItemAmounts(record.cost_items),
      sales_total: summaryFields.sumFeeItemAmounts(record.billing_items),
      billing_period: summaryFields.deriveBillingPeriod({ billing_items: record.billing_items }),
    }),
    normalizeBillingItemsForPersistence: (items) => items,
    getAuthHeaders: (headers) => ({ ...headers, "x-user-id": "1" }),
    showMessage: (message, type) => state.messages.push({ message, type }),
    renderBillingDetail: (target, record) => {
      target.dataset.serialNumber = record.serial_number;
      target.dataset.billingRecordJson = JSON.stringify(record);
      state.renderedRecord = record;
    },
    loadBillingRecords: async () => state.refreshes.push("list"),
    loadOrderBillingDetails: async (serial) => state.refreshes.push(serial),
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (state.submit) {
        return state.submit(url, options);
      }
      return {
        ok: !state.saveError,
        json: async () => state.saveError
          ? { error: "Save failed" }
          : { record: { ...state.records.get("A002"), ...JSON.parse(options.body) } },
      };
    },
  });
  const start = source.indexOf("function getBillingDetailContainer(");
  const end = source.indexOf("function switchBillingTemplate(", start);
  vm.runInContext(source.slice(start, end), context);
  return { context, container, elements, state };
}

async function testLifecycleAndPayload() {
  const { context, container, elements, state } = createContext();
  await context.showBillingFeeModal("billingPage", "", "A002");
  const modal = elements.get("billingFeeModal");
  assert.ok(modal);
  assert.ok(modal.editorsHtml.includes('id="billingCostResult"'));
  assert.ok(modal.editorsHtml.includes('id="billingSalesResult"'));
  assert.ok(modal.editorsHtml.includes('id="billingPeriodResult"'));
  assert.doesNotMatch(modal.editorsHtml, /费用明细|data-billing-row/u);
  assert.match(modal.markup, /id="billingSerialNumber"[^>]*readonly/u);
  assert.equal(modal.fields["#billingSerialNumber"].value, "A002");
  assert.equal(modal.fields["#billingSerialNumber"].readOnly, true);
  assert.doesNotMatch(modal.markup, /name="serial_number"/u);

  modal.fields["#billingCostResult"].value = "25";
  modal.fields["#billingSalesResult"].value = "30";
  modal.fields["#billingPeriodResult"].value = "2026-10";
  modal.fields["#billingCompletedTime_billingPage"].value = "2026-10-24";
  await context.saveBillingFeeModal();

  assert.equal(state.requests.length, 1, JSON.stringify(state.messages));
  assert.equal(state.requests[0].url, "/api/billing/serial/A002");
  const payload = JSON.parse(state.requests[0].options.body);
  assert.deepEqual(Object.keys(payload).sort(), [
    "billing_completed_time",
    "billing_items",
    "billing_template_key",
    "cost_items",
  ]);
  assert.equal(payload.billing_template_key, "legacy");
  assert.equal(payload.billing_completed_time, "2026-10-24");
  assert.equal(payload.cost_items.length, 1);
  assert.equal(payload.cost_items[0].amount, "25");
  assert.equal(payload.billing_items.length, 1);
  assert.equal(payload.billing_items[0].amount, "30");
  assert.equal(payload.billing_items[0].billing_period, "2026-10");
  assert.equal(elements.has("billingFeeModal"), false);
  assert.equal(context.currentBillingSerialNumber, "A002");
  assert.deepEqual(state.refreshes, ["list", "A002"]);
  assert.equal(state.renderedRecord.serial_number, "A002");
  assert.equal(state.renderedRecord.billing_period, "2026-10");
  assert.equal(context.currentOrderBillingData.cost_items[0].amount, "25");
  assert.ok(state.messages.some((message) => message.message === "账单信息保存成功"));

  container.dataset.serialNumber = "A001";
}

async function testSaveFailureAndDuplicateSubmit() {
  const { context, elements, state } = createContext();
  await context.showBillingFeeModal("billingPage", "", "A002");
  const modal = elements.get("billingFeeModal");
  state.saveError = true;
  await context.saveBillingFeeModal();
  assert.equal(elements.get("billingFeeModal"), modal);
  assert.ok(state.messages.some((message) => message.type === "error"));
  assert.equal(state.messages.some((message) => message.message === "账单信息保存成功"), false);

  state.saveError = false;
  let finishSave;
  state.submit = () => new Promise((resolve) => { finishSave = resolve; });
  const saving = context.saveBillingFeeModal();
  await context.saveBillingFeeModal();
  assert.equal(state.requests.length, 2);
  assert.equal(elements.get("billingFeeModal"), modal);
  finishSave({
    ok: true,
    json: async () => ({
      record: {
        ...state.records.get("A002"),
        billing_items: [{ category: "Historical sales", amount: "12.5", billing_period: "2026-09" }],
      },
    }),
  });
  await saving;
  assert.equal(elements.has("billingFeeModal"), false);
}

async function testClearedResultsSubmitEmptyArrays() {
  const { context, elements, state } = createContext();
  await context.showBillingFeeModal("billingPage", "", "A002");
  const modal = elements.get("billingFeeModal");
  modal.fields["#billingCostResult"].value = "";
  modal.fields["#billingSalesResult"].value = "";
  modal.fields["#billingPeriodResult"].value = "";
  await context.saveBillingFeeModal();

  const payload = JSON.parse(state.requests[0].options.body);
  assert.deepEqual(payload.cost_items, []);
  assert.deepEqual(payload.billing_items, []);
  assert.equal(elements.has("billingFeeModal"), false);
}

async function testLoadGuards() {
  const { context, container, elements, state } = createContext();
  let finishLoad;
  state.load = () => new Promise((resolve) => { finishLoad = resolve; });
  const loading = context.showBillingFeeModal("billingPage", "", "A001");
  context.hideBillingFeeModal();
  finishLoad(structuredClone(state.records.get("A001")));
  await loading;
  assert.equal(elements.has("billingFeeModal"), false);

  delete state.load;
  container.dataset.renderOptions = JSON.stringify({ editable: false });
  await context.showBillingFeeModal("billingPage", "", "A001");
  assert.equal(elements.has("billingFeeModal"), false);
  await context.showBillingFeeModal("orderDetail", "", "A001");
  assert.equal(elements.has("billingFeeModal"), false);

  container.dataset.renderOptions = JSON.stringify({ editable: true });
  state.loadError = true;
  await context.showBillingFeeModal("billingPage", "", "A001");
  assert.equal(elements.has("billingFeeModal"), false);
  assert.ok(state.messages.some((message) => message.message.includes("Load failed")));
}

async function testBackendSaveAndReload() {
  const historical = {
    serial_number: "A001",
    billing_template_key: "legacy",
    cost_items: JSON.stringify([{ category: "Historical cost", amount: "0", remark: "keep" }]),
    billing_items: JSON.stringify([{
      category: "Historical sales",
      amount: "12.5",
      billing_period: "2026-09",
      supplier: "keep",
    }]),
    billing_completed_time: "2026-10-01",
  };
  let persisted = { ...historical };
  const db = {
    async execute(sql, params = []) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS billing_info")) return [[]];
      if (sql.includes("information_schema.COLUMNS")) return [[{ count: 1 }]];
      if (sql.startsWith("SELECT serial_number FROM orders")) {
        return [[{ serial_number: "A001" }]];
      }
      if (sql.startsWith("SELECT billing_template_key")) return [[{ ...persisted }]];
      if (sql.includes("FROM orders o")) {
        return [[{
          ...persisted,
          billing_period_raw: "2026-08",
        }]];
      }
      if (sql.includes("INSERT INTO billing_info")) {
        persisted = {
          serial_number: params[0],
          billing_template_key: params[1],
          billing_completed_time: params[2],
          cost_items: params[3],
          billing_items: params[4],
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const router = createBillingRouter(db);
  async function request(method, body = {}, urlSerial = "A001") {
    const layer = router.stack.find(({ route }) =>
      route?.path === "/serial/:serial_number" && route.methods[method]
    );
    let response;
    let statusCode = 200;
    await layer.route.stack[0].handle(
      { params: { serial_number: urlSerial }, body },
      {
        status(code) {
          statusCode = code;
          return this;
        },
        json(value) { response = JSON.parse(JSON.stringify(value)); },
      }
    );
    assert.equal(statusCode, 200);
    return response.record;
  }

  const updated = await request("put", {
    serial_number: "A999",
    billing_template_key: "legacy",
    billing_completed_time: "2026-10-24",
    cost_items: [{ category: "Historical cost", amount: "25", remark: "" }],
    billing_items: [{
      category: "Historical sales",
      amount: "30",
      billing_period: "2026-10",
      supplier: "updated",
    }],
  });
  const reloaded = await request("get");
  assert.equal(persisted.serial_number, "A001");
  assert.equal(updated.serial_number, "A001");
  assert.deepEqual(updated, reloaded);
  assert.equal(reloaded.billing_completed_time, "2026-10-24");
  assert.equal(reloaded.cost_total, "25");
  assert.equal(reloaded.sales_total, "30");
  assert.equal(JSON.parse(persisted.billing_items).find((item) => item.category === "Historical sales").billing_period, "2026-10");
  assert.equal(reloaded.billing_period, "2026-10");
  assert.equal(reloaded.cost_items[0].remark, "");
  assert.equal(
    reloaded.billing_items.find((item) => item.category === "Historical sales").billing_period,
    "2026-10"
  );

  const retainedHistory = await request("put", { billing_completed_time: "2026-10-25" });
  assert.equal(
    retainedHistory.cost_items.find((item) => item.category === "Historical cost").amount,
    "25"
  );
  assert.equal(
    retainedHistory.billing_items.find((item) => item.category === "Historical sales").billing_period,
    "2026-10"
  );

  const cleared = await request("put", {
    billing_items: [{ category: "Historical sales", amount: "30", billing_period: "" }],
  });
  assert.equal(cleared.billing_period, "");
  assert.equal(
    cleared.billing_items.find((item) => item.category === "Historical sales").billing_period,
    ""
  );

  const explicitlyRemoved = await request("put", { cost_items: [], billing_items: [] });
  assert.equal(explicitlyRemoved.cost_total, "");
  assert.equal(explicitlyRemoved.sales_total, "");
  assert.equal(explicitlyRemoved.billing_period, "");
}

async function run() {
  await testLifecycleAndPayload();
  await testSaveFailureAndDuplicateSubmit();
  await testClearedResultsSubmitEmptyArrays();
  await testLoadGuards();
  await testBackendSaveAndReload();
  console.log("billing_update_mode_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
