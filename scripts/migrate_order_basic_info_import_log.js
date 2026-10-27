require("dotenv").config();
const mysql = require("mysql2/promise");

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "order_system",
  });

  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS order_basic_info_import_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        operator_user_id VARCHAR(100) NOT NULL,
        operation_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        file_name VARCHAR(255) NOT NULL,
        total_count INT NOT NULL DEFAULT 0,
        success_count INT NOT NULL DEFAULT 0,
        failed_count INT NOT NULL DEFAULT 0,
        serial_numbers JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order_basic_info_import_log_operator (operator_user_id),
        INDEX idx_order_basic_info_import_log_time (operation_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("order_basic_info_import_log migration: ok");
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error("order_basic_info_import_log migration failed:", error.message);
  process.exitCode = 1;
});
