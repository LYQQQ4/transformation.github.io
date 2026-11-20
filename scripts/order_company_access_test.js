require("dotenv").config();
const assert = require("node:assert/strict");
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const { migrateAuthSchema } = require("./migrate_auth_sessions");
const { migrateOrderCompanyAccess } = require("./migrate_order_company_access");
const { loadSession, requireSession, sendError } = require("../backend/lib/request_auth");
const { createOrderAccess, normalizedCompanySql, validateCompanyName } = require("../backend/lib/order_access");
const { getOrderImportHeaders, ORDER_IMPORT_FIELDS } = require("../backend/lib/order_import_schema");
const { BASIC_INFO_SHEET_NAME } = require("../backend/lib/order_basic_info_import");

async function run() {
  assert.throws(() => createOrderAccess(null), { statusCode: 401 });
  for (const value of [null, "", " \t\n\u3000", 1, "A".repeat(201)]) {
    assert.throws(() => validateCompanyName(value), { statusCode: 400 });
  }
  assert.equal(validateCompanyName(" \tAcme\u3000"), "Acme");
  assert.equal(createOrderAccess({ role: "user" }).sql(), "1 = 0");
  assert.equal(createOrderAccess({ role: "admin" }).sql(), "1 = 1");
  assert.throws(() => createOrderAccess({ role: "user" }, ["Acme"]).assertCompany("acme"), { statusCode: 403 });

  const config = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || "",
    connectTimeout: 5000,
  };
  const root = await mysql.createConnection(config);
  const suffix = `${process.pid}_${Date.now()}`;
  const orderSchema = `order_company_access_test_orders_${suffix}`;
  const userSchema = `order_company_access_test_users_${suffix}`;
  const created = [];
  let orderDb;
  let userDb;
  let server;
  let checks = 0;
  try {
    for (const schema of [orderSchema, userSchema]) {
      await root.query(`CREATE DATABASE ${mysql.escapeId(schema)} CHARACTER SET utf8mb4`);
      created.push(schema);
    }
    const source = process.env.DB_NAME || "order_system";
    const [tables] = await root.query(`SHOW TABLES FROM ${mysql.escapeId(source)}`);
    for (const entry of tables) {
      const table = Object.values(entry)[0];
      await root.query(`CREATE TABLE ${mysql.escapeId(orderSchema)}.${mysql.escapeId(table)}
        LIKE ${mysql.escapeId(source)}.${mysql.escapeId(table)}`);
    }
    orderDb = mysql.createPool({ ...config, database: orderSchema, connectionLimit: 5 });
    userDb = mysql.createPool({ ...config, database: userSchema, connectionLimit: 5 });
    await userDb.execute(`CREATE TABLE users (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NULL, password_hash VARCHAR(255), role VARCHAR(20), email VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    const migration = await userDb.getConnection();
    try {
      await migrateAuthSchema(migration, userSchema);
      await migrateOrderCompanyAccess(migration);
      await migrateOrderCompanyAccess(migration);
    } finally {
      migration.release();
    }
    const password = "Order-Access-Test-Only-736291";
    const hash = await bcrypt.hash(password, 4);
    for (const [username, role] of [["admin", "admin"], ["operator", "user"], ["empty", "user"]]) {
      await userDb.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [username, hash, role]);
    }
    for (const company of ["", " \t\u3000", " Acme "]) {
      await assert.rejects(
        () => userDb.execute("INSERT INTO user_order_companies (user_id, company_name) VALUES (2, ?)", [company]),
        (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED"
      );
    }

    // Only isolated fixture columns are relaxed to exercise legacy NULL/blank data.
    await orderDb.execute("ALTER TABLE orders MODIFY COLUMN company_name VARCHAR(200) NULL");
    const [columns] = await orderDb.execute("SHOW COLUMNS FROM orders");
    async function insertOrder(serial, company) {
      const values = {
        serial_number: serial, company_name: company, customer_id: "ch002", sender_id: "ch001",
        sender_company: "SenderRegistry", receiver_company: "ReceiverRegistry", orderer: "Tester",
        origin: `Origin-${serial}`, business_type: "Air", destination: "Shanghai",
      };
      for (const column of columns) {
        if (column.Null === "NO" && column.Default === null && !column.Extra.includes("auto_increment") &&
            !Object.hasOwn(values, column.Field)) {
          values[column.Field] = /date|time/.test(column.Type) ? "2026-11-17" : /int|decimal|float|double/.test(column.Type) ? 1 : "test";
        }
      }
      const keys = Object.keys(values).filter((key) => columns.some((column) => column.Field === key));
      const [result] = await orderDb.execute(
        `INSERT INTO orders (${keys.map(mysql.escapeId).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        keys.map((key) => values[key])
      );
      await orderDb.execute("INSERT INTO `package` (serial_number, package_label, package_order) VALUES (?, ?, 1)", [serial, "Box"]);
      await orderDb.execute("INSERT INTO transfer (serial_number, tracking_number) VALUES (?, ?)", [serial, `TN-${serial}`]);
      await orderDb.execute("INSERT INTO pickup_transport_tracking (serial_number) VALUES (?)", [serial]);
      await orderDb.execute("INSERT INTO customs_clearance_tracking (serial_number) VALUES (?)", [serial]);
      return result.insertId;
    }
    const fixtures = [
      ["S001", " Acme "], ["S002", "Beta"], ["S003", "acme"], ["S004", null],
      ["S005", ""], ["S006", "\t\u3000Acme\ufeff"], ["S007", " \t "], ["S008", "Acmé"],
    ];
    const ids = {};
    for (const [serial, company] of fixtures) ids[serial] = await insertOrder(serial, company);
    await orderDb.execute("UPDATE orders SET sender_company = 'Acme', receiver_company = 'Acme' WHERE serial_number = 'S002'");
    const [normalization] = await orderDb.execute(
      `SELECT ${normalizedCompanySql("company_name")} AS name FROM orders ORDER BY id`
    );
    assert.deepEqual(normalization.map((row) => row.name), ["Acme", "Beta", "acme", "", "", "Acme", "", "Acmé"]);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => loadSession(userDb, req, res, next));
    app.use("/api/users", require("../backend/routes/order_company_access")(userDb, orderDb));
    app.use("/api/users", require("../backend/routes/users")(userDb));
    app.use("/api/auth", require("../backend/routes/auth")(userDb));
    app.use("/api/user-profiles", requireSession, require("../backend/routes/user_profiles")(userDb, orderDb));
    for (const [path, file] of [
      ["orders", "orders"], ["reports", "reports"], ["billing", "billing"],
      ["packages", "packages"], ["transfers", "transfer"], ["pickup-trackings", "pickup_trackings"],
      ["customs-clearance", "customs_clearance"], ["input-memory", "input_memory"],
    ]) {
      app.use(`/api/${path}`, requireSession, require(`../backend/routes/${file}`)(orderDb, userDb));
    }
    app.use((error, _req, res, _next) => sendError(res, error));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, cookie, { method = "GET", body, status = 200 } = {}) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
      checks += 1;
      return response;
    }
    async function json(path, cookie, options) {
      return (await request(path, cookie, options)).json();
    }
    async function login(username) {
      return (await request("/users/login", null, {
        method: "POST", body: { username, password },
      })).headers.get("set-cookie").split(";")[0];
    }
    const admin = await login("admin");
    const operator = await login("operator");
    const empty = await login("empty");
    for (const path of ["/orders", `/orders/${ids.S002}`, "/reports/summary", "/billing", "/packages"]) {
      await request(path, null, { status: 401 });
    }
    assert.equal((await json("/orders", admin)).orders.length, fixtures.length);
    assert.equal((await json("/orders", empty)).orders.length, 0);
    for (const [path, method, body] of [
      ["/users/order-companies", "GET"], ["/users/2/order-companies", "GET"],
      ["/users/2/order-companies", "PUT", { companies: ["Acme"] }],
      ["/users/2/order-companies", "POST", { company_name: "Acme" }],
      ["/users/2/order-companies", "DELETE", { company_name: "Acme" }],
    ]) {
      await request(path, operator, { method, body, status: 403 });
      await request(path, null, { method, body, status: 401 });
    }
    assert.deepEqual((await json("/users/order-companies", admin)).companies, ["Acme", "Acmé", "Beta", "acme"]);
    const listedUsers = (await json("/users", admin)).users;
    for (const user of listedUsers) {
      const permissions = await json(`/users/${user.id}/order-companies`, admin);
      assert.equal(String(permissions.user_id), String(user.id), "permission entry must use the listed login user ID");
    }
    await request("/users/999999/order-companies", admin, { status: 404 });
    await json("/users/2/order-companies", admin, {
      method: "PUT", body: { companies: ["SenderRegistry", "ReceiverRegistry"] },
    });
    assert.equal((await json("/orders", operator)).orders.length, 0, "sender/receiver grants do not grant order access");
    await request("/orders/serial/S001", operator, { status: 404 });
    await json("/users/2/order-companies", admin, { method: "PUT", body: { companies: [" Acme ", "Acme"] } });
    assert.deepEqual((await json("/users/2/order-companies", admin)).companies, ["Acme"]);
    await json("/users/2/order-companies", admin, { method: "POST", body: { company_name: "Acme" } });
    const [count] = await userDb.execute("SELECT COUNT(*) AS total FROM user_order_companies WHERE user_id = 2");
    assert.equal(count[0].total, 1);
    assert.deepEqual((await json("/orders", operator)).orders.map((row) => row.serial_number).sort(), ["S001", "S006"]);
    assert.equal((await json("/orders?company_name=Beta&role=admin&user_id=1", operator)).orders.length, 0);
    await request(`/orders/${ids.S002}`, operator, { status: 404 });
    await request("/orders/serial/S002", operator, { status: 404 });
    assert.equal((await json(`/orders/${ids.S001}`, operator)).order.serial_number, "S001");
    await request("/orders/bulk-basic-info-template?serial_numbers=S001,S002", operator, { status: 404 });
    const exported = await request("/orders/bulk-basic-info-template?serial_numbers=S001,S006", operator);
    const basicBytes = Buffer.from(await exported.arrayBuffer());
    const report = await json("/reports/summary?serial_number=S&sender_company=Registry", operator);
    assert.deepEqual(report.rows.map((row) => row.serial_number).sort(), ["S001", "S006"]);
    const reportExport = await request("/reports/export", operator);
    const reportBook = XLSX.read(Buffer.from(await reportExport.arrayBuffer()), { type: "buffer" });
    assert.equal(XLSX.utils.sheet_to_json(reportBook.Sheets[reportBook.SheetNames[0]]).length, 2);
    await request("/billing/export", operator, {
      method: "POST", body: { serial_numbers: ["S001", "S002"] }, status: 400,
    });
    for (const [module, key] of [
      ["packages", "packages"], ["transfers", "transfers"], ["pickup-trackings", "pickupTrackings"],
      ["customs-clearance", "records"], ["billing", "records"],
    ]) {
      const list = (await json(`/${module}`, operator))[key];
      assert.deepEqual(list.map((row) => row.serial_number).sort(), ["S001", "S006"], module);
      await request(`/${module}/serial/S002`, operator, { status: 404 });
      await request(`/${module}/serial/S002`, operator, { method: "PUT", body: {}, status: 404 });
      await request(`/${module}/SERIAL/S002`, operator, { method: "PUT", body: {}, status: 404 });
      assert.equal((await json(`/${module}`, empty))[key].length, 0);
    }
    const [transferRows] = await orderDb.execute("SELECT id FROM transfer WHERE serial_number = 'S001'");
    for (const [module, table] of [
      ["packages", "package"], ["transfers", "transfer"], ["customs-clearance", "customs_clearance_tracking"],
    ]) {
      const [rows] = await orderDb.execute(`SELECT id FROM \`${table}\` WHERE serial_number = 'S001'`);
      const body = module === "packages"
        ? { serial_number: "S001", package_label: "Authorized", pieces: 2 }
        : module === "transfers"
          ? { serial_number: "S001", tracking_number: "AUTHORIZED-TN" }
          : { serial_number: "S001", customs_supplier: "Authorized Supplier" };
      await json(`/${module}/${rows[0].id}`, operator, { method: "PUT", body });
      await json(`/${module}/serial/S001`, operator, {
        method: "PUT", body: module === "packages" ? { packages: [body] } : body,
      });
    }
    await request(`/transfers/${transferRows[0].id}`, operator, {
      method: "PUT", body: { serial_number: "S002" }, status: 404,
    });
    for (const [module, table] of [["packages", "package"], ["transfers", "transfer"], ["customs-clearance", "customs_clearance_tracking"]]) {
      const [rows] = await orderDb.execute(`SELECT id FROM \`${table}\` WHERE serial_number = 'S002'`);
      await request(`/${module}/${rows[0].id}`, operator, { status: 404 });
      await request(`/${module}/%${rows[0].id.toString().charCodeAt(0).toString(16)}`, operator, {
        method: "DELETE", status: 404,
      });
    }
    for (const [module, field] of [
      ["pickup-trackings", "pickup_date"], ["transfers", "delivery_time"], ["customs-clearance", "tax_payment_time"],
      ["orders", "billing_completed_time"],
    ]) {
      const result = await json(`/${module}/batch-date`, operator, {
        method: "PUT", body: { serial_numbers: ["S001", "S002"], field, value: "2026-11-17" },
      });
      assert.equal(result.updated_count, 1, module);
      assert.deepEqual(result.not_found_serial_numbers, ["S002"], module);
    }
    const billingTemplate = await request("/billing/export", admin, {
      method: "POST", body: { serial_numbers: ["S001", "S002"] },
    });
    const billingBook = XLSX.read(Buffer.from(await billingTemplate.arrayBuffer()), { type: "buffer" });
    billingBook.Sheets["账单"].P2 = { t: "n", v: 10 };
    billingBook.Sheets["账单"].P3 = { t: "n", v: 20 };
    const billingForm = new FormData();
    billingForm.append("file", new Blob([XLSX.write(billingBook, { type: "buffer", bookType: "xlsx" })]), "billing-access.xlsx");
    const billingImport = await fetch(`${base}/billing/import`, {
      method: "POST", headers: { Cookie: operator }, body: billingForm,
    });
    assert.equal(billingImport.status, 200);
    const billingResult = await billingImport.json();
    assert.equal(billingResult.summary.updated, 1, JSON.stringify(billingResult));
    assert.equal(billingResult.summary.failed, 1, JSON.stringify(billingResult));
    const [betaBills] = await orderDb.execute("SELECT * FROM billing_info WHERE serial_number = 'S002'");
    assert.equal(betaBills.length, 0);
    const batch = await json("/orders/batch-receive-date", operator, {
      method: "PUT", body: { serial_numbers: ["S001", "S002"], receive_date: "2026-11-17" },
    });
    assert.equal(batch.updated_count, 1);
    assert.deepEqual(batch.not_found_serial_numbers, ["S002"]);
    const [unchanged] = await orderDb.execute("SELECT receive_date FROM orders WHERE serial_number = 'S002'");
    assert.equal(unchanged[0].receive_date, null);
    const suggestions = await json("/input-memory/suggestions", operator);
    assert.ok(!suggestions.fields.origin.some((item) => item.value === "Origin-S002"));
    await json("/input-memory/suggestions", admin);
    assert.ok(!(await json("/input-memory/suggestions", empty)).fields.origin.length);

    for (const value of ["", " \t ", null, "X".repeat(201), 123]) {
      await request("/users/2/order-companies", admin, { method: "POST", body: { company_name: value }, status: 400 });
    }
    await request("/users/999999/order-companies", admin, { method: "PUT", body: { companies: ["Acme"] }, status: 404 });
    await request("/users/2/order-companies", admin, { method: "PUT", body: { companies: ["Beta", ""] }, status: 400 });
    assert.deepEqual((await json("/users/2/order-companies", admin)).companies, ["Acme"]);
    // A real insert failure after DELETE must roll back the whole replacement.
    await userDb.query(`CREATE TRIGGER order_access_test_failure BEFORE INSERT ON user_order_companies
      FOR EACH ROW BEGIN IF NEW.company_name = 'FAIL' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected test failure'; END IF; END`);
    await request("/users/2/order-companies", admin, {
      method: "PUT", body: { companies: ["Beta", "FAIL"] }, status: 500,
    });
    assert.deepEqual((await json("/users/2/order-companies", admin)).companies, ["Acme"]);
    await userDb.query("DROP TRIGGER order_access_test_failure");

    for (const [id, company] of [["ch001", "SenderRegistry"], ["ch002", "ReceiverRegistry"]]) {
      await json("/user-profiles", admin, { method: "POST", body: {
        id, company_name: company, address: "Address", contact_name: "Contact", phone: "123",
      } });
    }
    assert.deepEqual((await json("/users/order-companies", admin)).companies, ["Acme", "Acmé", "Beta", "acme"],
      "profile companies must not enter the permission options");
    for (const cookie of [admin, operator, empty]) {
      const names = (await json("/input-memory/suggestions", cookie)).fields.company_name.map((item) => item.value);
      assert.ok(!names.includes("SenderRegistry") && !names.includes("ReceiverRegistry"),
        "company-name suggestions must not merge sender/receiver profiles");
    }
    const payload = {
      company_name: "Acme", orderer: "Tester", customer_id: "ch002", sender_id: "ch001",
      origin: "Shanghai", destination: "Tokyo", business_type: "Air",
      shipping_address: "A", sender_name: "Sender", sender_phone: "123",
      delivery_address: "B", receiver_name: "Receiver", receiver_phone: "456",
    };
    await request("/orders", operator, { method: "POST", body: { ...payload, company_name: "Beta" }, status: 403 });
    await request("/orders", operator, { method: "POST", body: { ...payload, company_name: "" }, status: 400 });
    await request("/orders", admin, { method: "POST", body: { ...payload, company_name: "" }, status: 400 });
    const createdOrder = await json("/orders", operator, { method: "POST", body: payload });
    await request(`/orders/${createdOrder.id}`, operator, {
      method: "PUT", body: { ...payload, company_name: "Beta" }, status: 403,
    });
    await request(`/orders/${ids.S002}`, operator, { method: "PUT", body: payload, status: 404 });
    await json(`/orders/${createdOrder.id}`, operator, { method: "PUT", body: { ...payload, company_name: " Acme " } });
    const [stillBeta] = await orderDb.execute("SELECT company_name FROM orders WHERE serial_number = 'S002'");
    assert.equal(stillBeta[0].company_name, "Beta");

    async function upload(path, cookie, bytes) {
      const form = new FormData();
      form.append("excelFile", new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }), "access-test.xlsx");
      const response = await fetch(`${base}${path}`, { method: "POST", headers: { Cookie: cookie }, body: form });
      assert.equal(response.status, 200, await response.clone().text());
      checks += 1;
      return response.json();
    }
    const importBook = XLSX.utils.book_new();
    const rows = ["Acme", "Beta", ""].map((company) => ORDER_IMPORT_FIELDS.map((field) =>
      field.key === "company_name" ? company : payload[field.key] || ""
    ));
    XLSX.utils.book_append_sheet(importBook, XLSX.utils.aoa_to_sheet([getOrderImportHeaders(), ...rows]), "Orders");
    const imported = await upload("/orders/import-excel", operator, XLSX.write(importBook, { type: "buffer", bookType: "xlsx" }));
    assert.equal(imported.results.success, 1, JSON.stringify(imported));
    assert.equal(imported.results.failed, 2);
    const basicBook = XLSX.read(basicBytes, { type: "buffer" });
    basicBook.Sheets[BASIC_INFO_SHEET_NAME].B2 = { t: "s", v: "Beta" };
    const basicResult = await upload("/orders/bulk-basic-info", operator, XLSX.write(basicBook, { type: "buffer", bookType: "xlsx" }));
    assert.ok(basicResult.results.failed >= 1, JSON.stringify(basicResult));
    const [unchangedCompany] = await orderDb.execute("SELECT company_name FROM orders WHERE serial_number = 'S001'");
    assert.equal(unchangedCompany[0].company_name, " Acme ");

    await json("/users/2/order-companies", admin, { method: "POST", body: { company_name: "Beta" } });
    await request("/orders/serial/S002", operator);
    await json("/users/2/order-companies", admin, { method: "DELETE", body: { company_name: "Beta" } });
    await request("/orders/serial/S002", operator, { status: 404 });
    await json("/users/2/order-companies", admin, { method: "PUT", body: { companies: [] } });
    assert.equal((await json("/orders", operator)).orders.length, 0);
    // A permission database outage is an error, never an empty successful result.
    await userDb.execute("RENAME TABLE user_order_companies TO permission_test_unavailable");
    await request("/orders", operator, { status: 500 });
    await request("/orders", admin);
    await userDb.execute("RENAME TABLE permission_test_unavailable TO user_order_companies");
    console.log(`order_company_access_test: passed ${checks} HTTP checks plus SQL, normalization, import and rollback assertions`);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (orderDb) await orderDb.end();
    if (userDb) await userDb.end();
    for (const schema of created) {
      if (!/^order_company_access_test_(orders|users)_\d+_\d+$/.test(schema)) throw new Error("Unsafe test schema cleanup");
      await root.query(`DROP DATABASE ${mysql.escapeId(schema)}`);
    }
    await root.end();
  }
}

run().catch((error) => {
  console.error("order_company_access_test failed:", error);
  process.exitCode = 1;
});
