const assert = require("assert");
const express = require("express");

const createOrdersRouter = require("../backend/routes/orders");
const {
  BATCH_DATE_FIELD_DEFINITIONS,
  BATCH_DATE_FIELD_MAP,
  validateBatchDateRequest,
  validateUnifiedBatchDateRequest,
} = require("../backend/lib/batch_date");

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
    beginCount: 0,
    releaseCount: 0,
  };

  const execute = async (sql, params = []) => {
    if (state.failSync && sql.includes("WHERE serial_number = ?")) {
      throw new Error("sync failed");
    }
    if (sql.includes("CREATE TABLE IF NOT EXISTS billing_info") ||
        sql.includes("ALTER TABLE billing_info")) {
      return [[]];
    }
    if (sql.includes("information_schema.COLUMNS")) {
      return [[{ count: 1 }]];
    }
    if (sql.startsWith("SELECT serial_number FROM billing_info")) {
      return state.values.has(params[0]) ? [[{ serial_number: params[0] }]] : [[]];
    }
    if (sql.startsWith("UPDATE billing_info")) {
      state.values.set(params[1], params[0]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO billing_info")) {
      state.values.set(params[0], params[1]);
      return [{ affectedRows: 1 }];
    }
    if (/^SELECT serial_number FROM (orders|pickup_transport_tracking|customs_clearance_tracking|transfer)/.test(sql)) {
      return [[...state.orders]
        .filter((serialNumber) => params.includes(serialNumber))
        .map((serial_number) => ({ serial_number }))];
    }
    if (sql.startsWith("UPDATE ") && sql.includes("WHERE serial_number IN")) {
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
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  return {
    async execute(sql, params) {
      return execute(sql, params);
    },
    async getConnection() {
      const snapshot = new Map(state.values);
      const syncSnapshot = new Map(state.syncValues);
      return {
        beginTransaction() { state.beginCount += 1; },
        async commit() {
          state.commitCount += 1;
        },
        async rollback() {
          state.rollbackCount += 1;
          state.values = new Map(snapshot);
          state.syncValues = new Map(syncSnapshot);
        },
        execute,
        release() { state.releaseCount += 1; },
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
  assert.ok(Object.hasOwn(BATCH_DATE_FIELD_MAP, "billing_completed_time"));
  for (const [moduleName, fields] of Object.entries(BATCH_DATE_FIELD_DEFINITIONS)) {
    assert.ok(!Object.hasOwn(fields, "billing_completed_time"));
    assert.ok(validateBatchDateRequest(moduleName, { field: "billing_completed_time" }).error);
  }
  assert.strictEqual(validateUnifiedBatchDateRequest({
    field: "billing_completed_time",
    serial_numbers: ["A001"],
    value: "2026-09-21",
  }).value, "2026-09-21");

  const db = createDb();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers["x-user-id"];
    if (userId === "1" || userId === "2") {
      req.user = { id: Number(userId), role: userId === "1" ? "admin" : "user" };
    }
    next();
  });
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
  assert.strictEqual(response.status, 200);
  assert.strictEqual(db.state.values.get("A001"), "2026-09-21");

  for (const userId of ["1", "2"]) {
    for (const [field, definition] of Object.entries(BATCH_DATE_FIELD_MAP)) {
      response = await request(app, {
        field,
        serial_numbers: ["A002"],
        value: definition.includeTime ? "2026-09-22T10:30" : "2026-09-22",
      }, { "x-user-id": userId });
      assert.strictEqual(response.status, 200, `${userId}: ${field}: ${JSON.stringify(response.body)}`);
      assert.strictEqual(response.body.field, field);
      assert.strictEqual(response.body.updated_count, 1);
      assert.strictEqual(db.state.values.get("A002"), definition.includeTime
        ? "2026-09-22 10:30:00" : "2026-09-22");
    }

    const beginBeforeInvalid = db.state.beginCount;
    for (const payload of [
      { field: "receive_date", serial_numbers: [], value: "2026-09-21" },
      { field: "receive_date", serial_numbers: [123], value: "2026-09-21" },
      { field: "receive_date", serial_numbers: [" "], value: "2026-09-21" },
      { field: "receive_date", serial_numbers: ["A".repeat(65)], value: "2026-09-21" },
      { field: "receive_date", serial_numbers: ["A001"], value: "2026-02-30" },
      { field: "arrival_time", serial_numbers: ["A001"], value: "2026-02-30" },
    ]) {
      response = await request(app, payload, { "x-user-id": userId });
      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error);
    }
    assert.strictEqual(db.state.beginCount, beginBeforeInvalid);
  }

  const beginBeforeUnauthenticated = db.state.beginCount;
  for (const headers of [{}, { "x-user-id": "999" }]) {
    response = await request(app, {
      field: "receive_date",
      serial_numbers: ["A001"],
      value: "2026-09-21",
    }, headers);
    assert.strictEqual(response.status, 401);
    assert.ok(response.body.error);
  }
  assert.strictEqual(db.state.beginCount, beginBeforeUnauthenticated);

  db.state.failSync = true;
  const beforeFailure = new Map(db.state.values);
  const syncBeforeFailure = new Map(db.state.syncValues);
  const commitsBeforeFailure = db.state.commitCount;
  for (const userId of ["1", "2"]) {
    response = await request(app, {
      field: "pickup_date",
      serial_numbers: ["A001", "A002"],
      value: "2026-09-25",
    }, { "x-user-id": userId });
    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(db.state.values, beforeFailure);
    assert.deepStrictEqual(db.state.syncValues, syncBeforeFailure);
  }
  assert.strictEqual(db.state.rollbackCount, 2);
  assert.strictEqual(db.state.commitCount, commitsBeforeFailure);
  assert.strictEqual(db.state.releaseCount, db.state.beginCount);

  const frontend = require("fs").readFileSync("frontend/app.js", "utf8");
  const frontendHtml = require("fs").readFileSync("frontend/index.html", "utf8");
  assert.ok(frontend.includes('apiFetch(`${API_BASE}/orders/batch-date`'));
  assert.ok(frontend.includes("orderBatchDateFieldMap"));
  assert.ok(!frontendHtml.includes("orderBatchDateModule"));
  assert.ok(!frontendHtml.includes("pickupBatchDateControls"));

  console.log("batch_date_unified_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
