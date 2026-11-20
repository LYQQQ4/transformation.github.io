const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function run() {
  const source = fs.readFileSync("frontend/app.js", "utf8");
  const html = fs.readFileSync("frontend/index.html", "utf8");
  const nodes = new Map();
  function element() {
    return {
      children: [], style: {}, textContent: "", disabled: false,
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; this.textContent = ""; },
    };
  }
  for (const id of ["orderCompanyPermissions", "orderCompanyPermissionsTitle", "orderCompanyPermissionsStatus", "orderCompanyPermissionsOptions"]) {
    assert.ok(html.includes(`id="${id}"`));
    nodes.set(id, element());
  }
  const controls = [element(), element(), element()];
  function inputs() {
    return nodes.get("orderCompanyPermissionsOptions").children.flatMap((label) =>
      label.children.filter((child) => child.type === "checkbox")
    );
  }
  let admin = true;
  let saved = ["Acme", "Legacy"];
  let failSave = false;
  let failLoad = false;
  const calls = [];
  const messages = [];
  const context = vm.createContext({
    document: {
      getElementById: (id) => nodes.get(id),
      createElement: element,
      createTextNode: (text) => ({ textContent: text }),
      querySelectorAll: (selector) => {
        const list = inputs();
        if (selector.includes("data-company-permission-control")) return [...controls, ...list];
        return selector.includes(":checked") ? list.filter((input) => input.checked) : list;
      },
    },
    API_BASE: "/api",
    isAdminUser: () => admin,
    showMessage: (message, type) => messages.push({ message, type }),
    apiFetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "PUT") {
        if (failSave) return { ok: false, json: async () => ({ error: "Save failed" }) };
        saved = JSON.parse(options.body).companies;
        return { ok: true, json: async () => ({ companies: saved }) };
      }
      if (failLoad) return { ok: false, json: async () => ({ error: "Load failed" }) };
      return { ok: true, json: async () => ({
        companies: url.endsWith("/users/order-companies") ? [" Acme ", "Acme", "", "Beta", "<b>literal</b>"] : saved,
      }) };
    },
  });
  const start = source.indexOf('let orderCompanyPermissionsTarget = "";');
  const end = source.indexOf("function showUserForm(", start);
  vm.runInContext(source.slice(start, end), context);
  await context.openOrderCompanyPermissions("2");
  assert.equal(inputs().length, 4);
  assert.deepEqual(inputs().filter((input) => input.checked).map((input) => input.value).sort(), ["Acme", "Legacy"]);
  assert.ok(nodes.get("orderCompanyPermissionsOptions").children.some((label) =>
    label.children.some((child) => child.textContent === "<b>literal</b>")
  ), "company names are text, not HTML");
  context.selectOrderCompanies(true);
  assert.ok(inputs().every((input) => input.checked));
  context.selectOrderCompanies(false);
  assert.ok(inputs().every((input) => !input.checked));
  inputs().find((input) => input.value === "Beta").checked = true;
  await context.saveOrderCompanyPermissions();
  assert.deepEqual(saved, ["Beta"]);
  assert.equal(nodes.get("orderCompanyPermissionsStatus").textContent, "已授权 1 家公司");
  assert.ok(messages.some((message) => message.message === "订单权限保存成功"));
  failSave = true;
  const successBefore = messages.filter((message) => message.message === "订单权限保存成功").length;
  await context.saveOrderCompanyPermissions();
  assert.equal(messages.at(-1).type, "error");
  assert.equal(nodes.get("orderCompanyPermissionsStatus").textContent, "Save failed");
  assert.equal(messages.filter((message) => message.message === "订单权限保存成功").length, successBefore);
  assert.ok(controls.every((control) => !control.disabled));
  failLoad = true;
  await context.openOrderCompanyPermissions("3");
  const callsBeforeSave = calls.length;
  await context.saveOrderCompanyPermissions();
  assert.equal(calls.length, callsBeforeSave, "failed load must never enable a destructive empty save");
  assert.equal(nodes.get("orderCompanyPermissionsStatus").textContent, "Load failed");
  failLoad = false;
  const pending = context.openOrderCompanyPermissions("2");
  context.closeOrderCompanyPermissions();
  await pending;
  assert.equal(nodes.get("orderCompanyPermissions").style.display, "none");
  admin = false;
  const before = calls.length;
  await context.openOrderCompanyPermissions("2");
  await context.saveOrderCompanyPermissions();
  assert.equal(calls.length, before);
  assert.ok(source.includes('userManagementLink.style.display = isAdminUser() ? "block" : "none"'));
  assert.ok(source.includes('cell.textContent = "暂无可查看的订单"'));
  console.log("order_company_access_frontend_test: passed selection, loading, save, error, stale request and role states");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
