const assert = require("assert");
const express = require("express");

const createOrdersRouter = require("../backend/routes/orders");

function createUserDb(role = "admin") {
  return {
    async execute(sql, params) {
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      if (params[0] === "1") {
        return [[{ id: 1, role }]];
      }
      if (params[0] === "2") {
        return [[{ id: 2, role: "user" }]];
      }
      return [[]];
    },
  };
}

function createDb(options = {}) {
  const state = {
    orders: new Set(options.orders || ["A001", "A002"]),
    values: new Map(),
    syncValues: new Map(),
    failSync: Boolean(options.failSync),
    rollbackCount: 0,
    commitCount: 0,
  };

  const execute = async (sql, params = []) => {
    if (state.failSync && sql.includes("WHERE serial_number = ?")) {
      throw new Error("sync failed");
    }
    if (sql.includes("CREATE TABLE IF NOT EXISTS billing_info") ||
        sql.includes("ALTER TABLE billing_info")) {
      return [[]];
    }
    if (sql.startsWith("SELECT serial_number FROM orders")) {
      return [[...state.orders]
        .filter((serialNumber) => params.includes(serialNumber))
        .map((serial_number) => ({ serial_number }))];
    }
    if (sql.startsWith("SELECT serial_number FROM pickup_transport_tracking")) {
      return [[...state.orders]
        .filter((serialNumber) => params.includes(serialNumber))
        .map((serial_number) => ({ serial_number }))];
    }
    if (sql.startsWith("INSERT INTO billing_info")) {
      state.values.set(params[0], params[1]);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE orders") && sql.includes("SET receive_date")) {
      params.slice(1).forEach((serialNumber) => state.values.set(serialNumber, params[0]));
      return [{ affectedRows: params.length - 1 }];
    }
    if (sql.includes("UPDATE transfer") || (
      sql.includes("UPDATE pickup_transport_tracking") &&
      sql.includes("WHERE serial_number = ?")
    )) {
      if (state.failSync) {
        throw new Error("sync failed");
      }
      state.syncValues.set(params[params.length - 1], params[0]);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE pickup_transport_tracking") && sql.includes("SET")) {
      params.slice(1).forEach((serialNumber) => state.values.set(serialNumber, params[0]));
      return [{ affectedRows: params.length - 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  return {
    async execute(sql, params) {
      return execute(sql, params);
    },
    async getConnection() {
      const snapshot = new Map(state.values);
      return {
        beginTransaction() {},
        async commit() {
          state.commitCount += 1;
        },
        async rollback() {
          state.rollbackCount += 1;
          state.values = new Map(snapshot);
        },
        execute,
        release() {},
      };
    },
    state,
  };
}

async function request(app, payload, headers = {}) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/batch-date`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function run() {
  const db = createDb();
  const app = express();
  app.use(express.json());
  app.use("/api/orders", createOrdersRouter(db, createUserDb()));

  let response = await request(app, {
    field: "receive_date",
    serial_numbers: ["A001", "A001", "MISSING"],
    value: "2026-09-21",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.updated_count, 1);
  assert.deepStrictEqual(response.body.not_found_serial_numbers, ["MISSING"]);
  assert.strictEqual(db.state.values.get("A001"), "2026-09-21");

  response = await request(app, {
    field: "orders.company_name",
    serial_numbers: ["A001"],
    value: "2026-09-21",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 400);

  response = await request(app, {
    field: "billing_completed_time",
    serial_numbers: ["A002"],
    value: "2026-09-21",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(db.state.values.get("A002"), "2026-09-21");

  response = await request(app, {
    field: "receive_date",
    serial_numbers: ["A001"],
    value: "2026-02-30",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 400);

  response = await request(app, {
    field: "receive_date",
    serial_numbers: ["A001"],
    value: "2026-09-21",
  }, { "x-user-id": "2" });
  assert.strictEqual(response.status, 403);

  db.state.failSync = true;
  response = await request(app, {
    field: "pickup_date",
    serial_numbers: ["A001"],
    value: "2026-09-21",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 500);
  assert.strictEqual(db.state.rollbackCount, 1);

  const frontend = require("fs").readFileSync("frontend/app.js", "utf8");
  const frontendHtml = require("fs").readFileSync("frontend/index.html", "utf8");
  assert.ok(frontend.includes('fetch(`${API_BASE}/orders/batch-date`'));
  assert.ok(frontend.includes("orderBatchDateFieldMap"));
  assert.ok(!frontendHtml.includes("orderBatchDateModule"));
  assert.ok(!frontendHtml.includes("pickupBatchDateControls"));

  console.log("batch_date_unified_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
