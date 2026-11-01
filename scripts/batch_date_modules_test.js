const assert = require("assert");
const express = require("express");

const createPickupRouter = require("../backend/routes/pickup_trackings");
const createCustomsRouter = require("../backend/routes/customs_clearance");
const createTransferRouter = require("../backend/routes/transfer");
const createBillingRouter = require("../backend/routes/billing");
const { BATCH_DATE_FIELD_DEFINITIONS } = require("../backend/lib/batch_date");

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
    syncSnapshot: null,
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
          state.syncSnapshot = new Map(state.syncValues);
        },
        async commit() { state.commitCount += 1; },
        async rollback() {
          state.rollbackCount += 1;
          if (state.transactionSnapshot) {
            state.values = new Map(state.transactionSnapshot);
            state.syncValues = new Map(state.syncSnapshot);
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
  app.use((req, _res, next) => {
    if (role !== "anonymous" && role !== "missing") {
      req.user = { id: 1, role: role === "user" ? "user" : "admin" };
    }
    next();
  });
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(role === "anonymous" ? {} : { "x-user-id": role === "missing" ? "2" : "1" }),
      },
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
    { field: "tax_payment_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(customsDb.state.values.get("A001"), "2026-09-15");
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
  assert.strictEqual(response.status, 200);
  customsRole = "admin";
  response = await request(
    customsRouter,
    { field: "tax_payment_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(customsDb.state.values.get("A001"), "2026-09-15");

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
  assert.strictEqual(transferDb.state.values.get("A001"), "2026-09-15");
  assert.strictEqual(transferDb.state.syncValues.get("A001"), "2026-09-15");

  const billingDb = createStatefulDb("billing", { values: [["A001", "2026-08-20"]] });
  response = await request(
    createBillingRouter(billingDb, createUserDb()),
    { field: "billing_completed_time", serial_numbers: ["A001"], value: "2026-09-15" }
  );
  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, "field is not allowed for this module");
  assert.strictEqual(billingDb.state.values.get("A001"), "2026-08-20");
  assert.strictEqual(billingDb.state.beginCount, 0);

  const routers = {
    pickup: "../backend/routes/pickup_trackings",
    customs: "../backend/routes/customs_clearance",
    transfer: "../backend/routes/transfer",
    billing: "../backend/routes/billing",
  };
  for (const [moduleName, routePath] of Object.entries(routers)) {
    for (const role of ["admin", "user"]) {
      // These modules own a singleton router, so reload to isolate each fixture.
      delete require.cache[require.resolve(routePath)];
      const createRouter = require(routePath);
      const db = createStatefulDb(moduleName, moduleName === "billing"
        ? { values: [["A001", "2026-08-20"]] } : {});
      const router = createRouter(db, createUserDb(role));
      const fields = BATCH_DATE_FIELD_DEFINITIONS[moduleName] || {};
      for (const [field, definition] of Object.entries(fields)) {
        response = await request(router, {
          field,
          serial_numbers: ["A001", "A001", "MISSING"],
          value: "2026-09-16",
        });
        assert.strictEqual(response.status, 200, `${moduleName}/${role}/${field}`);
        assert.strictEqual(response.body.updated_count, 1);
        assert.deepStrictEqual(response.body.not_found_serial_numbers, ["MISSING"]);
        const expectedValue = "2026-09-16";
        assert.strictEqual(db.state.values.get("A001"), expectedValue, `${moduleName}/${role}/${field}`);
        if (moduleName === "pickup" ||
            moduleName === "transfer" && ["pickup_date", "arrival_port_time"].includes(field)) {
          assert.strictEqual(db.state.syncValues.get("A001"), expectedValue);
        }
      }

      const valuesBeforeInvalid = new Map(db.state.values);
      const beginBeforeInvalid = db.state.beginCount;
      for (const field of Object.keys(fields)) {
        for (const invalid of [
          { serial_numbers: [], value: "2026-09-15" },
          { serial_numbers: [123], value: "2026-09-15" },
          { serial_numbers: [" "], value: "2026-09-15" },
          { serial_numbers: ["A".repeat(65)], value: "2026-09-15" },
          { serial_numbers: ["A001"], value: "2026-02-30" },
          { serial_numbers: ["A001"], value: "2026-09-15T25:00" },
        ]) {
          response = await request(router, { field, ...invalid });
          assert.strictEqual(response.status, 400, `${moduleName}/${role}/${field}/${JSON.stringify(invalid)}`);
          assert.ok(response.body.error);
        }
      }
      response = await request(router, {
        field: "billing_completed_time", serial_numbers: ["A001"], value: "2026-09-15",
      });
      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, "field is not allowed for this module");
      assert.strictEqual(db.state.beginCount, beginBeforeInvalid);
      assert.deepStrictEqual(db.state.values, valuesBeforeInvalid);

      const field = Object.keys(fields)[0] || "billing_completed_time";
      for (const identity of ["anonymous", "missing"]) {
        response = await request(router, {
          field, serial_numbers: ["A001"], value: "2026-09-15",
        }, "/batch-date", identity);
        assert.strictEqual(response.status, 401);
        assert.ok(response.body.error);
      }
      assert.strictEqual(db.state.beginCount, beginBeforeInvalid);

      if (moduleName === "pickup" || moduleName === "transfer") {
        const syncBeforeFailure = new Map(db.state.syncValues);
        const commitsBeforeFailure = db.state.commitCount;
        db.state.failSync = true;
        response = await request(router, {
          field: "pickup_date", serial_numbers: ["A001", "A002"], value: "2026-09-25",
        });
        assert.strictEqual(response.status, 500);
        assert.strictEqual(db.state.rollbackCount, 1);
        assert.strictEqual(db.state.commitCount, commitsBeforeFailure);
        assert.deepStrictEqual(db.state.values, valuesBeforeInvalid);
        assert.deepStrictEqual(db.state.syncValues, syncBeforeFailure);
      }
      assert.strictEqual(db.state.releaseCount, db.state.beginCount);
    }
  }

  console.log("batch_date_modules_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
