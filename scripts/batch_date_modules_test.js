const assert = require("assert");
const express = require("express");

const createPickupRouter = require("../backend/routes/pickup_trackings");
const createCustomsRouter = require("../backend/routes/customs_clearance");
const createTransferRouter = require("../backend/routes/transfer");
const createBillingRouter = require("../backend/routes/billing");

function createUserDb(role = "admin") {
  return {
    async execute(sql, params) {
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      return params[0] === "1" ? [[{ id: 1, role }]] : [[]];
    },
  };
}

function createStatefulDb(moduleName, options = {}) {
  const state = {
    values: new Map(options.values || [["A001", null], ["A002", null]]),
    syncValues: new Map(),
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
    failSync: Boolean(options.failSync),
    transactionSnapshot: null,
  };

  const tableName = {
    pickup: "pickup_transport_tracking",
    customs: "customs_clearance_tracking",
    transfer: "transfer",
  }[moduleName];

  const execute = async (sql, params = []) => {
    if (sql.startsWith("SELECT serial_number FROM orders")) {
      return [[...state.values.keys()].filter((serialNumber) => params.includes(serialNumber)).map((serial_number) => ({ serial_number }))];
    }
    if (sql.startsWith(`SELECT serial_number FROM ${tableName}`)) {
      return [[...state.values.keys()].filter((serialNumber) => params.includes(serialNumber)).map((serial_number) => ({ serial_number }))];
    }
    if (moduleName === "customs" && sql.startsWith("UPDATE customs_clearance_tracking SET")) {
      params.slice(1).forEach((serialNumber) => state.values.set(serialNumber, params[0]));
      return [{ affectedRows: params.length - 1 }];
    }
    if (sql.startsWith(`UPDATE ${tableName} SET`) && sql.includes("WHERE serial_number IN")) {
      if (state.failSync) {
        throw new Error("sync failed");
      }
      const serialNumbers = params.slice(1);
      serialNumbers.forEach((serialNumber) => state.values.set(serialNumber, params[0]));
      return [{ affectedRows: serialNumbers.length }];
    }
    if (sql.startsWith(`UPDATE ${tableName} SET`)) {
      if (moduleName === "billing") {
        throw new Error("unexpected billing update");
      }
      const match = sql.match(new RegExp(`UPDATE ${tableName} SET ([A-Za-z0-9_]+) = \\? WHERE serial_number = \\?`));
      assert.ok(match);
      state.values.set(params[1], params[0]);
      return [{ affectedRows: 1 }];
    }
    if ((sql.startsWith("UPDATE transfer SET") || sql.startsWith("UPDATE pickup_transport_tracking SET")) && sql.includes("WHERE serial_number = ?")) {
      if (state.failSync) {
        throw new Error("sync failed");
      }
      state.syncValues.set(params[params.length - 1], params[0]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO billing_info")) {
      state.values.set(params[0], params[1]);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const db = {
    async execute(sql, params = []) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS billing_info") || sql.includes("ALTER TABLE billing_info")) {
        return [[]];
      }
      if (sql.includes("information_schema.COLUMNS")) {
        return [[{ count: 1 }]];
      }
      return execute(sql, params);
    },
    async getConnection() {
      return {
        async beginTransaction() {
          state.beginCount += 1;
          state.transactionSnapshot = new Map(state.values);
        },
        async commit() { state.commitCount += 1; },
        async rollback() {
          state.rollbackCount += 1;
          if (state.transactionSnapshot) {
            state.values = new Map(state.transactionSnapshot);
          }
        },
        execute,
        release() { state.releaseCount += 1; },
      };
    },
    state,
  };
  return db;
}

async function request(router, payload, path = "/batch-date", role = "admin") {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": role === "missing" ? "2" : "1" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function run() {
  const pickupDb = createStatefulDb("pickup");
  let response = await request(
    createPickupRouter(pickupDb, createUserDb()),
    { field: "pickup_date", serial_numbers: ["A001", "A001", "MISSING"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.updated_count, 1);
  assert.deepStrictEqual(response.body.not_found_serial_numbers, ["MISSING"]);
  assert.strictEqual(pickupDb.state.values.get("A001"), "2026-09-15");
  assert.strictEqual(pickupDb.state.syncValues.get("A001"), "2026-09-15");

  const customsDb = createStatefulDb("customs");
  let customsRole = "admin";
  const customsUserDb = {
    async execute(sql, params) {
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      return params[0] === "1" ? [[{ id: 1, role: customsRole }]] : [[]];
    },
  };
  const customsRouter = createCustomsRouter(customsDb, customsUserDb);
  response = await request(
    customsRouter,
    { field: "receive_date", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 400);
  response = await request(
    customsRouter,
    { field: "tax_payment_time", serial_numbers: ["A001"], value: "2026-02-30" }
  );
  assert.strictEqual(response.status, 400);
  response = await request(
    customsRouter,
    { field: "tax_payment_time", serial_numbers: ["A001"], value: "2026-09-15T10:30" }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(customsDb.state.values.get("A001"), "2026-09-15 10:30:00");
  response = await request(
    customsRouter,
    { field: "tax_payment_time", serial_numbers: ["A001"], value: "2026-09-15T25:30" }
  );
  assert.strictEqual(response.status, 400);
  customsRole = "user";
  response = await request(
    customsRouter,
    { field: "tax_payment_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 403);
  customsRole = "admin";
  response = await request(
    customsRouter,
    { field: "tax_payment_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(customsDb.state.values.get("A001"), "2026-09-15 00:00:00");

  const transferDb = createStatefulDb("transfer", { failSync: true });
  const transferRouter = createTransferRouter(transferDb, createUserDb());
  const transferBeforeFailure = transferDb.state.values.get("A001");
  response = await request(
    transferRouter,
    { field: "arrival_port_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 500);
  assert.strictEqual(transferDb.state.rollbackCount, 1);
  assert.strictEqual(transferDb.state.values.get("A001"), transferBeforeFailure);

  transferDb.state.failSync = false;
  response = await request(
    transferRouter,
    { field: "arrival_port_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(transferDb.state.values.get("A001"), "2026-09-15 00:00:00");
  assert.strictEqual(transferDb.state.syncValues.get("A001"), "2026-09-15 00:00:00");

  const billingDb = createStatefulDb("billing");
  response = await request(
    createBillingRouter(billingDb, createUserDb()),
    { field: "billing_completed_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(billingDb.state.values.get("A001"), "2026-09-15");

  console.log("batch_date_modules_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
