const assert = require("assert");
const express = require("express");

const createOrdersRouter = require("../backend/routes/orders");

function createStatefulDb(state) {
  return {
    async getConnection() {
      return {
        async beginTransaction() {
          state.beginCount += 1;
        },
        async commit() {
          state.commitCount += 1;
        },
        async rollback() {
          state.rollbackCount += 1;
        },
        async execute(sql, params = []) {
          state.executions.push({ sql, params });

          if (sql.startsWith("SELECT serial_number FROM orders")) {
            return [[...state.orders]
              .filter(([serialNumber]) => params.includes(serialNumber))
              .map(([serial_number]) => ({ serial_number }))];
          }

          if (sql.startsWith("UPDATE orders SET receive_date")) {
            if (state.failUpdate) {
              throw new Error("database write failed");
            }

            const [receiveDate, ...serialNumbers] = params;
            serialNumbers.forEach((serialNumber) => state.orders.set(serialNumber, receiveDate));
            return [{ affectedRows: serialNumbers.length }];
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {
          state.releaseCount += 1;
        },
      };
    },
  };
}

function createUserDb(state) {
  return {
    async execute(sql, params) {
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      if (params[0] !== "1" || !state.role) {
        return [[]];
      }
      return [[{ id: 1, role: state.role }]];
    },
  };
}

async function request(app, payload, headers = {}) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/orders/batch-receive-date`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function createTestApp(state) {
  const app = express();
  app.use(express.json());
  app.use("/api/orders", createOrdersRouter(createStatefulDb(state), createUserDb(state)));
  return app;
}

async function run() {
  const state = {
    orders: new Map(),
    role: "admin",
    failUpdate: false,
    executions: [],
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
  };
  const app = createTestApp(state);

  state.orders = new Map([["A001", ""], ["A002", ""]]);
  let response = await request(app, {
    serial_numbers: ["A001", "A002", "A001", "MISSING"],
    receive_date: "2026-09-15",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.updated_count, 2);
  assert.deepStrictEqual(response.body.not_found_serial_numbers, ["MISSING"]);
  assert.strictEqual(state.orders.get("A001"), "2026-09-15");
  assert.strictEqual(state.orders.get("A002"), "2026-09-15");
  assert.strictEqual(state.beginCount, 1);
  assert.strictEqual(state.commitCount, 1);
  assert.strictEqual(state.rollbackCount, 0);
  const updateExecution = state.executions.find((item) => item.sql.startsWith("UPDATE orders SET receive_date"));
  assert.ok(updateExecution);
  assert.ok(!updateExecution.sql.includes("A001"));
  assert.deepStrictEqual(updateExecution.params, ["2026-09-15", "A001", "A002"]);

  response = await request(app, {
    serial_numbers: ["A001"],
    receive_date: "2026-02-30",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 400);

  response = await request(app, {
    serial_numbers: [],
    receive_date: "2026-09-15",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 400);

  state.role = "user";
  response = await request(app, {
    serial_numbers: ["A001"],
    receive_date: "2026-09-15",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 403);

  state.role = "admin";
  const beforeFailure = state.orders.get("A001");
  state.failUpdate = true;
  response = await request(app, {
    serial_numbers: ["A001"],
    receive_date: "2026-10-01",
  }, { "x-user-id": "1" });
  assert.strictEqual(response.status, 500);
  assert.strictEqual(state.orders.get("A001"), beforeFailure);
  assert.strictEqual(state.rollbackCount, 1);
  state.failUpdate = false;

  const frontend = require("fs").readFileSync("frontend/app.js", "utf8");
  assert.ok(frontend.includes("data-order-select-all"));
  assert.ok(frontend.includes("batchFillReceiveDate"));
  assert.ok(frontend.includes("clearOrderBatchSelection(false)"));

  console.log("batch_receive_date_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
