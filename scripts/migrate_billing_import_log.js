require("dotenv").config();
const mysql = require("mysql2/promise");
const { ensureImportAuditSchema } = require("../backend/lib/billing_excel");

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "order_system",
  });
  try {
    await ensureImportAuditSchema(connection);
    console.log("billing_import_log is ready; existing billing data is unchanged.");
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error("Billing audit migration failed:", error.code || error.message);
  process.exitCode = 1;
});
