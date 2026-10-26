const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("express");
const createOrdersRouter = require("../backend/routes/orders");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function testDeleteManagementMenu() {
  const html = read("frontend/index.html");
  assert.ok(html.includes('id="deleteOrdersLink"'), "should add delete orders menu entry");
  assert.ok(html.includes('id="deleteOrdersPage"'), "should add delete orders page");
}

function testViewOrdersNoDirectDeleteEntry() {
  const appJs = read("frontend/app.js");
  assert.ok(appJs.includes("allowsDelete: false"), "view orders page should disable delete actions");
  assert.ok(appJs.includes("allowsDelete: true"), "delete management page should enable delete actions");
  assert.ok(appJs.includes("deleteOrderFromManagement"), "delete management should have dedicated delete handler");
}

function testDeleteApiSplit() {
  const ordersRoute = read("backend/routes/orders.js");
  assert.ok(
    ordersRoute.includes('router.delete("/delete-management/:id"'),
    "should expose dedicated delete-management route"
  );
  assert.ok(
    ordersRoute.includes('router.delete("/:id"'),
    "should keep legacy delete route as explicit guard"
  );
  assert.ok(
    ordersRoute.includes("删除入口已迁移至删单管理页面"),
    "legacy delete route should reject old entry"
  );
  assert.ok(
    ordersRoute.includes('req.headers["x-order-delete-source"]'),
    "delete-management route should validate delete source header"
  );
}

async function testDeleteApiRemainsAdminOnly() {
  const state = { executions: [], commitCount: 0 };
  const db = {
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() { state.commitCount += 1; },
        async rollback() {},
        release() {},
        async execute(sql) {
          state.executions.push(sql);
          if (sql.startsWith("SELECT serial_number FROM orders")) {
            return [[{ serial_number: "A001" }]];
          }
          if (sql.startsWith("DELETE FROM ")) return [{ affectedRows: 1 }];
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const userDb = {
    async execute(sql, params) {
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      if (params[0] === "1") return [[{ id: 1, role: "admin" }]];
      if (params[0] === "2") return [[{ id: 2, role: "user" }]];
      return [[]];
    },
  };
  const app = express();
  app.use("/api/orders", createOrdersRouter(db, userDb));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    for (const [headers, expectedStatus] of [
      [{}, 401],
      [{ "x-user-id": "999" }, 401],
      [{ "x-user-id": "2" }, 403],
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/delete-management/1`, {
        method: "DELETE",
        headers: { "x-order-delete-source": "delete-management", ...headers },
      });
      assert.strictEqual(response.status, expectedStatus);
      assert.ok((await response.json()).error);
      assert.strictEqual(state.executions.length, 0);
      assert.strictEqual(state.commitCount, 0);
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/delete-management/1`, {
      method: "DELETE",
      headers: { "x-user-id": "1", "x-order-delete-source": "delete-management" },
    });
    assert.strictEqual(response.status, 200);
    assert.ok((await response.json()).message);
    assert.strictEqual(state.commitCount, 1);
    assert.strictEqual(state.executions.filter((sql) => sql.startsWith("DELETE FROM ")).length, 6);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function run() {
  testDeleteManagementMenu();
  testViewOrdersNoDirectDeleteEntry();
  testDeleteApiSplit();
  await testDeleteApiRemainsAdminOnly();
  console.log("order_delete_split_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
