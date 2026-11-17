require("dotenv").config();
const assert = require("assert/strict");
const mysql = require("mysql2/promise");
const express = require("express");
const XLSX = require("xlsx");
const createRouter = require("../backend/routes/billing");
const excel = require("../backend/lib/billing_excel");
const fields = require("../frontend/order_summary_fields");

async function run() {
  const config = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    connectTimeout: 5000,
  };
  const admin = await mysql.createConnection(config);
  const schema = `billing_batch_test_${process.pid}_${Date.now()}`;
  const source = process.env.DB_NAME || "order_system";
  const quote = (identifier) => mysql.escapeId(identifier);
  let db;
  let server;
  try {
    await admin.query(`CREATE DATABASE ${quote(schema)} CHARACTER SET utf8mb4`);
    for (const name of ["orders", "billing_info", "pickup_transport_tracking", "transfer", "package"]) {
      await admin.query(`CREATE TABLE ${quote(schema)}.${quote(name)} LIKE ${quote(source)}.${quote(name)}`);
    }
    db = mysql.createPool({ ...config, database: schema, connectionLimit: 4 });
    const [columns] = await db.execute("SHOW COLUMNS FROM orders");
    const mandatory = columns.filter((column) => column.Null === "NO" && column.Default === null && !column.Extra.includes("auto_increment"));
    const serials = Array.from({ length: 500 }, (_, index) => `TEST${String(index).padStart(4, "0")}`);
    for (const serial of serials) {
      await db.execute(`INSERT INTO orders (${mandatory.map((column) => quote(column.Field)).join(",")}) VALUES (${mandatory.map(() => "?").join(",")})`,
        mandatory.map((column) => column.Field === "serial_number" ? serial : "test"));
      await db.execute("INSERT INTO billing_info (serial_number, billing_template_key, cost_items, billing_items) VALUES (?, ?, ?, ?)",
        [serial, "legacy", JSON.stringify([{ category: "提货运输费", amount: "10", supplier: "preserve" }]),
          JSON.stringify([{ category: "提货运输费", amount: "20", billing_period: "2026-09" }])]);
    }
    await excel.ensureImportAuditSchema(db);
    await excel.ensureImportAuditSchema(db);
    const app = express();
    app.use(express.json());
    const users = { execute: async () => [[{ id: 1, role: "user" }]] };
    app.use("/api/billing", createRouter(db, users));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/billing`;
    const headers = { "x-user-id": "1" };
    async function exportFile(numbers) {
      const response = await fetch(`${base}/export`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ serial_numbers: numbers }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return Buffer.from(await response.arrayBuffer());
    }
    function editFile(buffer, changes) {
      const book = XLSX.read(buffer, { type: "buffer" });
      Object.entries(changes).forEach(([address, value]) => {
        book.Sheets["账单"][address] = { t: typeof value === "number" ? "n" : "s", v: value };
      });
      return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    }
    async function importFile(buffer) {
      const form = new FormData();
      form.append("file", new Blob([buffer]), "mysql_test.xlsx");
      const response = await fetch(`${base}/import`, { method: "POST", headers, body: form });
      return { status: response.status, data: await response.json() };
    }
    async function getRecord(serial) {
      const [records] = await db.execute("SELECT * FROM billing_info WHERE serial_number = ?", [serial]);
      return records[0];
    }
    const firstExport = await exportFile(serials.slice(0, 2));
    const filled = editFile(firstExport, { O2: 50.25, Q2: "2026-10" });
    let result = await importFile(filled);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.data.summary.updated, 1);
    assert.equal(fields.sumFeeItemAmounts((await getRecord(serials[0])).cost_items), "50.25");
    assert.equal(fields.sumFeeItemAmounts((await getRecord(serials[0])).billing_items), "20");

    // Two concurrent imports from the same snapshot must not both overwrite the row.
    const baseline = await exportFile([serials[0]]);
    const concurrent = await Promise.all([
      importFile(editFile(baseline, { O2: 61 })),
      importFile(editFile(baseline, { O2: 62 })),
    ]);
    assert.equal(concurrent.reduce((total, response) => total + response.data.summary.updated, 0), 1, JSON.stringify(concurrent));
    assert.equal(concurrent.reduce((total, response) => total + response.data.summary.failed, 0), 1);
    assert.ok([61, 62].includes(Number(fields.sumFeeItemAmounts((await getRecord(serials[0])).cost_items))));

    // Force a real SQL failure on the second row; the first UPDATE must roll back.
    const rollbackBaseline = await exportFile(serials.slice(0, 2));
    const originalCost = (await getRecord(serials[0])).cost_items;
    await db.query(`CREATE TRIGGER test_import_failure BEFORE UPDATE ON billing_info FOR EACH ROW
      BEGIN IF NEW.serial_number = 'TEST0001' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected test failure'; END IF; END`);
    result = await importFile(editFile(rollbackBaseline, { O2: 91, O3: 92 }));
    assert.equal(result.status, 500, JSON.stringify(result));
    assert.equal((await getRecord(serials[0])).cost_items, originalCost);
    await db.query("DROP TRIGGER test_import_failure");

    const all = await exportFile(serials);
    const updates = Object.fromEntries(serials.map((serial, index) => [`O${index + 2}`, 88.88]));
    const start = Date.now();
    result = await importFile(editFile(all, updates));
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.data.summary.updated, 500);
    const duration = Date.now() - start;
    assert.ok(duration < 15000, `Real MySQL 500 rows took ${duration}ms`);
    const list = await fetch(base, { headers });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).records.length, 500);
    const detail = await fetch(`${base}/serial/${serials[0]}`, { headers });
    assert.equal((await detail.json()).record.cost_total, "88.88");
    const single = await fetch(`${base}/serial/${serials[0]}`, {
      method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ billing_completed_time: "2026-10-27" }),
    });
    assert.equal(single.status, 200);
    const singleRecord = (await single.json()).record;
    assert.equal(singleRecord.cost_total, "88.88");
    assert.equal(fields.formatOrderSummaryValue("receive_date", (await getRecord(serials[0])).billing_completed_time), "2026/10/27");
    const [audit] = await db.execute("SELECT COUNT(*) AS total FROM billing_import_log");
    assert.equal(Number(audit[0].total), 4);
    console.log(`PASS: real MySQL schema clone, idempotent migration, row locks/concurrent conflict, SQL rollback, list/single edit, 500 rows (${duration}ms)`);

    // Existing orders may receive their first bill through the same import.
    const unbilledSerials = serials.slice(2, 10);
    await db.execute(`DELETE FROM billing_info WHERE serial_number IN (${unbilledSerials.map(() => "?").join(",")})`, unbilledSerials);
    await db.execute("UPDATE orders SET business_type = ? WHERE serial_number = ?", ["空运", serials[2]]);
    const unbilled = await exportFile(serials.slice(2, 8));
    result = await importFile(editFile(unbilled, {
      O2: 15.5, P2: 25.75, Q2: "2026-11",
      O4: "bad", O5: 0, Q6: "月结30天",
    }));
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.deepEqual(result.data.summary, { total: 6, updated: 3, failed: 1, skipped: 2, duplicated: 0 });
    assert.deepEqual(result.data.notFoundSerialNumbers, []);
    const firstBill = await getRecord(serials[2]);
    assert.equal(firstBill.billing_template_key, "air");
    assert.equal(fields.sumFeeItemAmounts(firstBill.cost_items), "15.5");
    assert.equal(fields.sumFeeItemAmounts(firstBill.billing_items), "25.75");
    assert.equal(fields.deriveBillingPeriod(firstBill), "2026-11");
    assert.equal(firstBill.billing_completed_time, null);
    assert.equal(await getRecord(serials[3]), undefined);
    assert.equal(await getRecord(serials[4]), undefined);
    const zeroBill = await getRecord(serials[5]);
    assert.equal(fields.sumFeeItemAmounts(zeroBill.cost_items), "0");
    assert.equal(zeroBill.billing_items, null);
    assert.equal(zeroBill.billing_template_key, null);
    const periodBill = await getRecord(serials[6]);
    assert.equal(periodBill.cost_items, null);
    assert.equal(fields.deriveBillingPeriod(periodBill), "月结30天");

    // Serialize concurrent first saves: one INSERT, then a stale-value failure.
    const firstSaveBaseline = await exportFile([serials[9]]);
    const firstSaves = await Promise.all([
      importFile(editFile(firstSaveBaseline, { O2: 31 })),
      importFile(editFile(firstSaveBaseline, { O2: 32 })),
    ]);
    assert.ok(firstSaves.every((response) => response.status === 200), JSON.stringify(firstSaves));
    assert.equal(firstSaves.reduce((sum, response) => sum + response.data.summary.updated, 0), 1);
    assert.equal(firstSaves.reduce((sum, response) => sum + response.data.summary.failed, 0), 1);
    const [billCount] = await db.execute("SELECT COUNT(*) AS total FROM billing_info WHERE serial_number = ?", [serials[9]]);
    assert.equal(Number(billCount[0].total), 1);

    const newBillRollback = await exportFile([serials[8], serials[1]]);
    const existingBeforeRollback = (await getRecord(serials[1])).cost_items;
    const [auditsBeforeRollback] = await db.execute("SELECT COUNT(*) AS total FROM billing_import_log");
    await db.query(`CREATE TRIGGER test_import_failure BEFORE UPDATE ON billing_info FOR EACH ROW
      BEGIN IF NEW.serial_number = 'TEST0001' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected test failure'; END IF; END`);
    result = await importFile(editFile(newBillRollback, { O2: 19, O3: 29 }));
    assert.equal(result.status, 500);
    assert.equal(await getRecord(serials[8]), undefined);
    assert.equal((await getRecord(serials[1])).cost_items, existingBeforeRollback);
    const [auditsAfterRollback] = await db.execute("SELECT COUNT(*) AS total FROM billing_import_log");
    assert.equal(Number(auditsAfterRollback[0].total), Number(auditsBeforeRollback[0].total));
    await db.query("DROP TRIGGER test_import_failure");
    const missingOrder = await exportFile([serials[7]]);
    result = await importFile(editFile(missingOrder, { A2: "NONEXISTENT_ORDER", O2: 10 }));
    assert.equal(result.data.summary.failed, 1);
    assert.deepEqual(result.data.notFoundSerialNumbers, ["NONEXISTENT_ORDER"]);
    assert.equal(await getRecord("NONEXISTENT_ORDER"), undefined);
    console.log("PASS: real MySQL first bill import, blank/invalid preservation, template selection, concurrent INSERT, new-bill rollback, missing order rejection");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.end();
    // Only this run's newly created, isolated test database is removed.
    await admin.query(`DROP DATABASE IF EXISTS ${quote(schema)}`);
    await admin.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
