const assert = require("assert/strict");
const express = require("express");
const XLSX = require("xlsx");
const createOrdersRouter = require("../backend/routes/orders");
const {
  BASIC_INFO_SHEET_NAME,
  INSTRUCTION_SHEET_NAME,
  METADATA_SHEET_NAME,
  buildBasicInfoWorkbook,
} = require("../backend/lib/order_basic_info_import");

const ORDER = {
  id: 1,
  serial_number: "202610001",
  company_name: "Acme",
  orderer: "Alice",
  business_type: "Air",
  sender_company: "Sender Co",
  receiver_company: "Receiver Co",
  sender_id: "ch001",
  customer_id: "ch002",
  receive_date: "2026-10-27",
  origin: "Shanghai",
  destination: "New York",
  trade_term: "FOB",
  product_name: "Parts",
  transport_mode: "Air",
  tracking_number: "000123",
  pieces: 3,
  single_weight: 2.5,
  actual_weight: 7.5,
  transport_supplier: "Carrier",
  value_added_services: "Keep dry",
  remark1: "R1",
  remark2: "R2",
  customs_port: "Shanghai Port",
  customs_declaration_number: "000045",
  customs_supplier: "Customs Co",
  updated_at: "2026-10-27 10:20:30",
};

function createDb() {
  const db = {
    async execute(sql) {
      if (sql.includes("FROM orders o")) return [[{ ...ORDER }]];
      if (sql.includes("SELECT serial_number FROM orders")) return [[{ serial_number: ORDER.serial_number }]];
      if (sql.includes("CREATE TABLE IF NOT EXISTS order_basic_info_import_log")) return [[]];
      if (sql.includes("INSERT INTO order_basic_info_import_log")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL in route test: ${sql}`);
    },
  };
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql) {
      if (sql.includes("FROM orders o")) return [[{ ...ORDER }]];
      if (sql.includes("FROM orders WHERE serial_number")) return [[{ ...ORDER }]];
      if (sql.includes("FROM pickup_transport_tracking WHERE")) return [[{ serial_number: ORDER.serial_number }]];
      if (sql.includes("FROM customs_clearance_tracking WHERE")) return [[{ serial_number: ORDER.serial_number }]];
      if (sql.trimStart().startsWith("SELECT")) return [[]];
      return [{ affectedRows: 1 }];
    },
    release() {},
  });
  return db;
}

function createUserDb(role = "admin") {
  const userDb = {
    role,
    async execute(sql) {
      if (sql.includes("FROM users")) return [[{ id: 7, role: userDb.role }]];
      if (sql.includes("FROM user_profiles")) return [[{ id: "ch001" }, { id: "ch002" }]];
      throw new Error(`Unexpected SQL in user route test: ${sql}`);
    },
  };
  return userDb;
}

async function startServer(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers["x-user-id"]) {
      req.user = {
        id: req.headers["x-user-id"],
        role: req.headers["x-user-role"] || "admin",
      };
    }
    next();
  });
  app.use("/api/orders", router);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const db = createDb();
  const userDb = createUserDb();
  const server = await startServer(createOrdersRouter(db, userDb));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/orders`;
    const headers = { "x-user-id": "7" };
    const exportResponse = await fetch(`${base}/bulk-basic-info-template?serial_numbers=${ORDER.serial_number}`, { headers });
    assert.equal(exportResponse.status, 200);
    const buffer = Buffer.from(await exportResponse.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    assert.deepEqual(workbook.SheetNames, [BASIC_INFO_SHEET_NAME, INSTRUCTION_SHEET_NAME, METADATA_SHEET_NAME]);
    const worksheetHeaders = XLSX.utils.sheet_to_json(workbook.Sheets[BASIC_INFO_SHEET_NAME], { header: 1 })[0];
    assert.deepEqual(worksheetHeaders.slice(3, 6), ["业务类型", "发件人公司", "收件人公司"]);
    assert.deepEqual(worksheetHeaders.slice(14, 17), ["运单号", "件数", "单件重量"]);
    assert.equal(workbook.Sheets[BASIC_INFO_SHEET_NAME].R2.f, 'IF(OR(P2="",Q2=""),"",ROUND(P2*Q2,2))');

    const form = new FormData();
    form.append(
      "excelFile",
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "basic-info.xlsx"
    );
    const previewResponse = await fetch(`${base}/parse-bulk-basic-info`, { method: "POST", headers, body: form });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.preview.total, 1);
    assert.equal(preview.preview.invalid, 0);

    const importForm = new FormData();
    importForm.append(
      "excelFile",
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "basic-info.xlsx"
    );
    const importResponse = await fetch(`${base}/bulk-basic-info`, { method: "POST", headers, body: importForm });
    assert.equal(importResponse.status, 200);
    const importResult = await importResponse.json();
    assert.equal(importResult.results.success, 1);
    assert.equal(importResult.results.failed, 0);

    const unauthorized = await fetch(`${base}/bulk-basic-info-template?serial_numbers=${ORDER.serial_number}`);
    assert.equal(unauthorized.status, 401);

    userDb.role = "user";
    const deniedForm = new FormData();
    deniedForm.append(
      "excelFile",
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "basic-info.xlsx"
    );
    const ordinaryImport = await fetch(`${base}/bulk-basic-info`, {
      method: "POST",
      headers,
      body: deniedForm,
    });
    assert.equal(ordinaryImport.status, 200);
    const ordinaryResult = await ordinaryImport.json();
    assert.equal(ordinaryResult.results.success, 1);
    console.log("order_basic_info_import_route_test: ok");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
