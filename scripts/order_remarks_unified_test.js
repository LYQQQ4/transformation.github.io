const assert = require("assert");
const {
  hasOrderRemarkFields,
  normalizeOrderRemarkPatch,
  syncOrderRemarksBySerial,
} = require("../backend/lib/order_remarks");
const { requireUserAccess } = require("../backend/lib/request_auth");

function createRemarkConnection(options = {}) {
  const state = {
    orders: new Map([["A001", { id: 1, serial_number: "A001", remark1: null, remark2: null }]]),
    legacy: new Map([
      ["pickup_transport_tracking", new Map([["A001", { remark1: "pickup-old", remark2: null }]])],
      ["transfer", new Map([["A001", { remark1: null, remark2: "transfer-old" }]])],
      ["customs_clearance_tracking", new Map([["A001", { remark1: null, remark2: null }]])],
    ]),
    failTable: options.failTable || null,
  };

  return {
    state,
    async execute(sql, params) {
      if (sql.startsWith("SELECT id, serial_number, remark1, remark2 FROM orders")) {
        const order = state.orders.get(params[0]);
        return [order ? [{ ...order }] : []];
      }
      if (sql.startsWith("UPDATE orders SET")) {
        const serialNumber = params[params.length - 1];
        const order = state.orders.get(serialNumber);
        const fields = [...sql.matchAll(/(remark[12]) = \?/g)].map((match) => match[1]);
        fields.forEach((field, index) => { order[field] = params[index]; });
        return [{ affectedRows: 1 }];
      }
      const tableMatch = sql.match(/^UPDATE (pickup_transport_tracking|transfer|customs_clearance_tracking) SET/);
      if (tableMatch) {
        if (state.failTable === tableMatch[1]) {
          throw new Error("forced legacy sync failure");
        }
        const row = state.legacy.get(tableMatch[1]).get(params[2]);
        row.remark1 = params[0];
        row.remark2 = params[1];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

async function runTransaction(connection, serialNumber, payload) {
  const snapshot = JSON.stringify({
    orders: [...connection.state.orders],
    legacy: [...connection.state.legacy].map(([name, rows]) => [name, [...rows]]),
  });
  try {
    return await syncOrderRemarksBySerial(connection, serialNumber, payload);
  } catch (error) {
    const parsed = JSON.parse(snapshot);
    connection.state.orders = new Map(parsed.orders);
    connection.state.legacy = new Map(parsed.legacy.map(([name, rows]) => [name, new Map(rows)]));
    throw error;
  }
}

function assertAllModules(connection, remark1, remark2) {
  const order = connection.state.orders.get("A001");
  assert.strictEqual(order.remark1, remark1);
  assert.strictEqual(order.remark2, remark2);
  for (const rows of connection.state.legacy.values()) {
    const row = rows.get("A001");
    assert.strictEqual(row.remark1, remark1);
    assert.strictEqual(row.remark2, remark2);
  }
}

async function run() {
  const connection = createRemarkConnection();

  for (const moduleName of ["pickup", "transfer", "customs", "orders"]) {
    await runTransaction(connection, "A001", {
      remark1: `${moduleName}-remark1`,
      remark2: `${moduleName}-remark2`,
    });
    assertAllModules(connection, `${moduleName}-remark1`, `${moduleName}-remark2`);
  }

  await runTransaction(connection, "A001", { remark1: "" });
  assertAllModules(connection, null, "orders-remark2");

  await runTransaction(connection, "A001", { remark2: null });
  assertAllModules(connection, null, null);

  await runTransaction(connection, "A001", {});
  assertAllModules(connection, null, null);
  assert.strictEqual(hasOrderRemarkFields({}), false);
  assert.strictEqual(hasOrderRemarkFields({ remark1: "" }), true);

  assert.throws(
    () => normalizeOrderRemarkPatch({ remark1: "x".repeat(1001) }),
    /cannot exceed 1000/
  );
  await assert.rejects(
    () => runTransaction(connection, "MISSING", { remark1: "x" }),
    (error) => error.statusCode === 404
  );

  const failedConnection = createRemarkConnection({ failTable: "transfer" });
  await assert.rejects(
    () => runTransaction(failedConnection, "A001", { remark1: "rollback", remark2: "rollback" }),
    /forced legacy sync failure/
  );
  assert.strictEqual(failedConnection.state.orders.get("A001").remark1, null);
  assert.strictEqual(failedConnection.state.legacy.get("pickup_transport_tracking").get("A001").remark1, "pickup-old");

  const userDb = {
    async execute(sql, params) {
      assert.strictEqual(sql, "SELECT id, role FROM users WHERE id = ? LIMIT 1");
      return params[0] === "1" ? [[{ id: 1, role: "user" }]] : [[]];
    },
  };
  await requireUserAccess(userDb, { user: { id: 1, role: "user" } }, "order remark update");
  await assert.rejects(
    () => requireUserAccess(userDb, { headers: { "x-user-id": "2" } }, "order remark update"),
    (error) => error.statusCode === 401
  );

  console.log("order_remarks_unified_test: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
