const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

function run() {
  testDeleteManagementMenu();
  testViewOrdersNoDirectDeleteEntry();
  testDeleteApiSplit();
  console.log("order_delete_split_test: ok");
}

run();
