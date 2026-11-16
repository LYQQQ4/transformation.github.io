require("dotenv").config();
const mysql = require("mysql2/promise");

const orderConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || "",
  database: process.env.DB_NAME || "order_system",
};
const userConfig = {
  ...orderConfig,
  host: process.env.USER_DB_HOST || orderConfig.host,
  port: Number(process.env.USER_DB_PORT || orderConfig.port),
  user: process.env.USER_DB_USER || orderConfig.user,
  password: process.env.USER_DB_PASSWORD || orderConfig.password,
  database: process.env.USER_DB_NAME || "user_system",
};

async function main() {
  const orderDb = await mysql.createConnection(orderConfig);
  const userDb = await mysql.createConnection(userConfig);
  try {
    for (const column of [
      ["sender_company", "发件人公司"],
      ["receiver_company", "收件人公司"],
    ]) {
      const [columns] = await orderDb.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = ?`,
        [column[0]]
      );
      if (!columns.length) {
        await orderDb.execute(
          `ALTER TABLE orders ADD COLUMN ${column[0]} VARCHAR(200) DEFAULT NULL COMMENT '${column[1]}'`
        );
      }
    }

    const [orders] = await orderDb.execute(
      "SELECT id, company_name, sender_id, customer_id FROM orders"
    );
    for (const order of orders) {
      const ids = [order.sender_id, order.customer_id].filter(Boolean);
      if (!ids.length) {
        continue;
      }
      const placeholders = ids.map(() => "?").join(", ");
      const [profiles] = await userDb.execute(
        `SELECT id, company_name FROM user_profiles WHERE id IN (${placeholders})`,
        ids
      );
      const profileMap = new Map(profiles.map((profile) => [String(profile.id), profile.company_name]));
      const senderCompany = profileMap.get(String(order.sender_id)) || null;
      const receiverCompany = profileMap.get(String(order.customer_id)) || null;
      await orderDb.execute(
        `UPDATE orders
         SET sender_company = COALESCE(sender_company, ?),
             receiver_company = COALESCE(receiver_company, ?)
         WHERE id = ?`,
        [senderCompany, receiverCompany, order.id]
      );
    }
    console.log(`Migrated ${orders.length} orders.`);
  } finally {
    await Promise.all([orderDb.end(), userDb.end()]);
  }
}

main().catch((error) => {
  console.error("Order company migration failed:", error.message);
  process.exitCode = 1;
});
