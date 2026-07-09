require("dotenv").config();
const mysql = require("mysql2/promise");

const userDbConfig = {
  host: process.env.USER_DB_HOST || process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.USER_DB_PORT || process.env.DB_PORT || "3306", 10),
  user: process.env.USER_DB_USER || process.env.DB_USER || "root",
  password: process.env.USER_DB_PASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.USER_DB_NAME || "user_system",
  ssl: process.env.DB_SSL === "true" ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "60000", 10),
};

const orderDbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "order_system",
  ssl: process.env.DB_SSL === "true" ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "60000", 10),
};

async function main() {
  const migrationBatch = process.argv[2];
  if (!migrationBatch) {
    throw new Error("请提供 migration_batch，例如: node scripts/rollback_user_profiles_migration.js 20260709123045");
  }

  const userDb = await mysql.createConnection(userDbConfig);
  const orderDb = await mysql.createConnection(orderDbConfig);

  try {
    const [rows] = await userDb.execute(
      "SELECT legacy_type, legacy_id, user_profile_id FROM user_profile_migration_map WHERE migration_batch = ?",
      [migrationBatch]
    );

    let revertedCustomers = 0;
    let revertedSenders = 0;

    for (const row of rows) {
      if (row.legacy_type === "customer") {
        const [result] = await orderDb.execute(
          "UPDATE orders SET customer_id = ? WHERE customer_id = ?",
          [row.legacy_id, row.user_profile_id]
        );
        revertedCustomers += result.affectedRows || 0;
      }

      if (row.legacy_type === "sender") {
        const [result] = await orderDb.execute(
          "UPDATE orders SET sender_id = ? WHERE sender_id = ?",
          [row.legacy_id, row.user_profile_id]
        );
        revertedSenders += result.affectedRows || 0;
      }
    }

    await userDb.execute("DELETE FROM user_profiles WHERE migration_batch = ?", [migrationBatch]);
    await userDb.execute("DELETE FROM user_profile_migration_map WHERE migration_batch = ?", [migrationBatch]);

    console.log("Rollback completed");
    console.log(`migration_batch=${migrationBatch}`);
    console.log(`orders_customer_reverted=${revertedCustomers}`);
    console.log(`orders_sender_reverted=${revertedSenders}`);
  } finally {
    await userDb.end();
    await orderDb.end();
  }
}

main().catch((error) => {
  console.error("Rollback failed:", error.message);
  process.exit(1);
});
