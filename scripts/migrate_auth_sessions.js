const mysql = require("mysql2/promise");

async function columnExists(connection, database, table, column) {
  const [rows] = await connection.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [database, table, column]
  );
  return rows.length > 0;
}

async function migrateAuthSchema(connection, database = process.env.USER_DB_NAME || "user_system") {
  await connection.changeUser({ database });
  const [tables] = await connection.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' LIMIT 1`,
    [database]
  );
  if (tables.length === 0) {
    throw new Error(`Required users table is missing in ${database}`);
  }

  if (!(await columnExists(connection, database, "users", "password_hash"))) {
    await connection.execute(
      "ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL"
    );
  }
  if (await columnExists(connection, database, "users", "password")) {
    const [columns] = await connection.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password'`,
      [database]
    );
    if (columns[0]?.IS_NULLABLE === "NO") {
      await connection.execute("ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NULL");
    }
  }

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      last_seen_at DATETIME NULL,
      ip_address VARCHAR(128) NULL,
      user_agent VARCHAR(512) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_sessions_user_id (user_id),
      KEY idx_sessions_expiry (expires_at),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  return { database };
}

module.exports = { migrateAuthSchema };

if (require.main === module) {
  require("dotenv").config();
  (async () => {
    const password = process.env.USER_DB_PASSWORD || process.env.DB_PASSWORD;
    if (process.env.NODE_ENV === "production" && !password) {
      throw new Error("USER_DB_PASSWORD or DB_PASSWORD is required in production");
    }
    const connection = await mysql.createConnection({
      host: process.env.USER_DB_HOST || process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.USER_DB_PORT || process.env.DB_PORT || 3306),
      user: process.env.USER_DB_USER || process.env.DB_USER || "root",
      password: password || "",
      database: process.env.USER_DB_NAME || "user_system",
      ssl: process.env.DB_SSL === "true" ? {} : false
    });
    try {
      await migrateAuthSchema(connection);
      console.log("Authentication schema migration complete.");
    } finally {
      await connection.end();
    }
  })().catch((error) => {
    console.error("Authentication schema migration failed:", error.code || "migration_error");
    process.exitCode = 1;
  });
}
