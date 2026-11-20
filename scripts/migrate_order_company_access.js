const mysql = require("mysql2/promise");
const { normalizedCompanySql } = require("../backend/lib/order_access");

async function migrateOrderCompanyAccess(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_order_companies (
      user_id BIGINT UNSIGNED NOT NULL,
      company_name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, company_name),
      KEY idx_user_order_companies_company (company_name),
      CONSTRAINT fk_user_order_companies_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT chk_user_order_company_not_empty CHECK (
        CHAR_LENGTH(${normalizedCompanySql("company_name")}) > 0
        AND CAST(company_name AS BINARY) = CAST(${normalizedCompanySql("company_name")} AS BINARY)
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = { migrateOrderCompanyAccess };

if (require.main === module) {
  require("dotenv").config();
  (async () => {
    const password = process.env.USER_DB_PASSWORD || process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || "";
    if (process.env.NODE_ENV === "production" && !password) {
      throw new Error("USER_DB_PASSWORD or DB_PASSWORD is required in production");
    }
    const db = await mysql.createConnection({
      host: process.env.USER_DB_HOST || process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.USER_DB_PORT || process.env.DB_PORT || 3306),
      user: process.env.USER_DB_USER || process.env.DB_USER || "root",
      password,
      database: process.env.USER_DB_NAME || "user_system",
      ssl: process.env.DB_SSL === "true" ? {} : false,
    });
    try {
      await migrateOrderCompanyAccess(db);
      console.log("Order company access migration complete.");
    } finally {
      await db.end();
    }
  })().catch((error) => {
    console.error("Order company access migration failed:", error.code || error.message);
    process.exitCode = 1;
  });
}
