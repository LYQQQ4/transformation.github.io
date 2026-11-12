const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const createOrdersRouter = require("../backend/routes/orders");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

async function testOrderListDataSource() {
  const queries = [];
  const orders = [
    { id: 1, serial_number: "202610001", trade_term: "FOB", tracking_number: "TN001" },
    { id: 2, serial_number: "202610002", trade_term: "CIF", tracking_number: null },
    { id: 3, serial_number: "202610003", trade_term: "EXW", tracking_number: "" },
  ];
  const db = {
    async execute(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        return [[{ max_length: 255, is_nullable: "YES" }]];
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS billing_info")) {
        return [[]];
      }

      assert.ok(sql.includes("FROM orders o"));
      assert.ok(sql.includes("LEFT JOIN transfer t ON t.serial_number = o.serial_number"));
      const includeTrackingNumber = sql.includes("t.tracking_number AS tracking_number");
      return [orders.map(({ tracking_number, ...order }) => (
        includeTrackingNumber ? { ...order, tracking_number } : order
      ))];
    },
  };
  const router = createOrdersRouter(db);
  async function get(routePath, request) {
    const layer = router.stack.find(({ route }) => route?.path === routePath && route.methods.get);
    assert.ok(layer, `Missing GET route: ${routePath}`);
    let body;
    const response = {
      status(code) {
        assert.fail(`Unexpected HTTP status: ${code}`);
      },
      json(value) {
        body = value;
      },
    };
    await layer.route.stack[0].handle(request, response);
    assert.ok(body);
    return body;
  }

  const result = await get("/", { query: { company_name: "Test", origin: "Shanghai" } });
  assert.deepStrictEqual(result.orders.map((order) => order.tracking_number), ["TN001", null, ""]);
  assert.deepStrictEqual(result.orders.map((order) => order.trade_term), ["FOB", "CIF", "EXW"]);
  const listQuery = queries[queries.length - 1];
  assert.deepStrictEqual(listQuery.params, ["%Test%", "%Shanghai%"]);
  assert.ok(listQuery.sql.includes("WHERE o.company_name LIKE ? AND o.origin LIKE ?"));
  assert.ok(listQuery.sql.includes("ORDER BY o.serial_number DESC"));

  for (const [routePath, params] of [
    ["/:id", { id: "1" }],
    ["/serial/:serial_number", { serial_number: "202610001" }],
  ]) {
    const detail = await get(routePath, { params });
    assert.strictEqual(detail.order.trade_term, "FOB");
    assert.ok(!Object.prototype.hasOwnProperty.call(detail.order, "tracking_number"));
    assert.ok(!queries[queries.length - 1].sql.includes("t.tracking_number AS tracking_number"));
  }
}

function testOrderListPresentation(realOrders = []) {
  const source = read("frontend/app.js");
  const tables = { ordersTable: [], deleteOrdersTable: [] };
  const heads = {};
  let lastPaginationTable;
  const context = vm.createContext({
    ORDER_PAGE_VIEW: "viewOrders",
    activeOrderPageContext: "viewOrders",
    console,
    getOrderPageState(pageName) {
      return { tableId: pageName === "viewOrders" ? "ordersTable" : "deleteOrdersTable" };
    },
    clearOrderBatchSelection() {},
    formatDateOnly(value) {
      return value || "";
    },
    escapeHtml(value) {
      return String(value);
    },
    buildOrderActionButtons() {
      return "";
    },
    applyRenderedTablePagination(tableId) {
      lastPaginationTable = tableId;
    },
    document: {
      getElementById() {
        return null;
      },
      querySelector(selector) {
        const tableId = selector.split(" ")[0].slice(1);
        if (selector.endsWith(" thead")) {
          return heads[tableId];
        }
        return {
          set innerHTML(value) {
            assert.strictEqual(value, "");
            tables[tableId] = [];
          },
          insertRow() {
            const row = {};
            tables[tableId].push(row);
            return row;
          },
        };
      },
    },
  });
  const displayStart = source.indexOf("function displayOrders(");
  const displayEnd = source.indexOf("function renderOrderDetailView(", displayStart);
  vm.runInContext(source.slice(displayStart, displayEnd), context);
  const headStart = source.indexOf("function ensureOrderIndexStructure(");
  const headEnd = source.indexOf("function getFilterInputValue(", headStart);
  vm.runInContext(source.slice(headStart, headEnd), context);

  for (const trackingNumber of ["TN001", "", null, undefined]) {
    const order = { id: 1, serial_number: "202610001", trade_term: "FOB", tracking_number: trackingNumber };
    context.displayOrders([order], "viewOrders");
    const cells = [...tables.ordersTable[0].innerHTML.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
    assert.strictEqual(cells.length, 19);
    assert.strictEqual(cells[10], trackingNumber || "");
    assert.strictEqual(lastPaginationTable, "ordersTable");

    context.displayOrders([order], "deleteOrders");
    const deleteCells = [...tables.deleteOrdersTable[0].innerHTML.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
    assert.strictEqual(deleteCells.length, 20);
    assert.strictEqual(deleteCells[9], "FOB");
    assert.strictEqual(lastPaginationTable, "deleteOrdersTable");
  }
  context.displayOrders([
    { id: 1, serial_number: "202610001", tracking_number: "TN001" },
    { id: 2, serial_number: "202610002", tracking_number: "TN002" },
  ], "viewOrders");
  assert.ok(tables.ordersTable[0].innerHTML.includes("TN002"));
  assert.ok(tables.ordersTable[1].innerHTML.includes("TN001"));
  context.displayOrders(realOrders.slice(), "viewOrders");
  const expectedOrders = realOrders.slice().sort((a, b) => (
    (parseInt(b.serial_number || b.id) || 0) - (parseInt(a.serial_number || a.id) || 0)
  ));
  assert.strictEqual(tables.ordersTable.length, expectedOrders.length);
  expectedOrders.forEach((order, index) => {
    const cells = [...tables.ordersTable[index].innerHTML.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
    assert.ok(cells[1].includes(`showOrderDetails(${order.id})`));
    assert.strictEqual(cells[10], order.tracking_number || "");
  });
  context.displayOrders([], "viewOrders");
  assert.strictEqual(tables.ordersTable.length, 0);

  for (const [pageName, tableId, expectedTitle] of [
    ["viewOrders", "ordersTable", "运单号"],
    ["deleteOrders", "deleteOrdersTable", "贸易术语"],
  ]) {
    heads[tableId] = { textContent: "", innerHTML: "", querySelector: () => ({}) };
    context.ensureOrderIndexStructure(pageName);
    assert.ok(heads[tableId].innerHTML.includes(`<th>${expectedTitle}</th>`));
    if (pageName === "viewOrders") {
      assert.ok(!heads[tableId].innerHTML.includes("<th>账期</th>"));
    }
  }

  const html = read("frontend/index.html");
  const orderHead = html.match(/<table id="ordersTable">([\s\S]*?)<\/thead>/)[1];
  assert.ok(orderHead.includes("<th>运单号</th>"));
  assert.ok(!orderHead.includes("<th>账期</th>"));
  assert.ok(!orderHead.includes("<th>贸易术语</th>"));
  const deleteHead = html.match(/<table id="deleteOrdersTable">([\s\S]*?)<\/thead>/)[1];
  assert.ok(deleteHead.includes("<th>贸易术语</th>"));
  assert.ok(deleteHead.includes("<th>账期</th>"));
}

async function testLiveOrderList(baseUrl) {
  require("dotenv").config();
  const mysql = require("mysql2/promise");
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "order_system",
    ssl: process.env.DB_SSL === "true" ? {} : false,
    connectTimeout: 10000,
  });

  try {
    await db.query("START TRANSACTION READ ONLY");
    const [rows] = await db.execute(`
      SELECT o.id, o.serial_number, t.tracking_number,
        t.serial_number AS transfer_serial_number
      FROM orders o
      LEFT JOIN transfer t ON t.serial_number = o.serial_number
      ORDER BY o.serial_number DESC
    `);
    const [counts] = await db.execute("SELECT COUNT(*) AS order_count FROM orders");
    assert.strictEqual(rows.length, counts[0].order_count, "Transport join must not duplicate or remove orders");
    assert.strictEqual(new Set(rows.map((row) => String(row.id))).size, rows.length);

    const response = await fetch(new URL("/api/orders", baseUrl), {
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(response.status, 200);
    const { orders } = await response.json();
    assert.ok(Array.isArray(orders));
    assert.strictEqual(orders.length, rows.length);
    const ordersById = new Map(orders.map((order) => [String(order.id), order]));
    assert.strictEqual(ordersById.size, rows.length, "API must not duplicate orders");
    rows.forEach((row) => {
      const order = ordersById.get(String(row.id));
      assert.ok(order, `Missing order ${row.id}`);
      assert.strictEqual(order.serial_number, row.serial_number);
      assert.ok(Object.prototype.hasOwnProperty.call(order, "tracking_number"));
      assert.strictEqual(order.tracking_number, row.tracking_number, `Incorrect tracking number for ${row.serial_number}`);
    });
    assert.deepStrictEqual(
      orders.map((order) => String(order.id)),
      rows.map((row) => String(row.id)),
      "API order must match the database serial-number ordering"
    );
    console.log(JSON.stringify({
      live_url: baseUrl,
      verified_orders: rows.length,
      missing_transfer_records: rows.filter((row) => row.transfer_serial_number === null).length,
      empty_tracking_numbers: rows.filter((row) => !String(row.tracking_number || "").trim()).length,
      distinct_tracking_numbers: new Set(rows.map((row) => row.tracking_number)).size,
    }));
    return orders;
  } finally {
    try {
      await db.rollback();
    } finally {
      await db.end();
    }
  }
}

async function run() {
  await testOrderListDataSource();
  const liveIndex = process.argv.indexOf("--live");
  const realOrders = liveIndex >= 0
    ? await testLiveOrderList(process.argv[liveIndex + 1] || "http://127.0.0.1:3000")
    : [];
  testOrderListPresentation(realOrders);
  console.log("order_list_tracking_number_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
