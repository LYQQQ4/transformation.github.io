require("dotenv").config();
const mysql = require("mysql2/promise");

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "order_system",
  });

  try {
    await connection.beginTransaction();
    const [backfillResult] = await connection.execute(`
      UPDATE orders o
      LEFT JOIN pickup_transport_tracking p ON p.serial_number = o.serial_number
      LEFT JOIN transfer t ON t.serial_number = o.serial_number
      LEFT JOIN customs_clearance_tracking c ON c.serial_number = o.serial_number
      SET
        o.remark1 = COALESCE(NULLIF(o.remark1, ''), NULLIF(p.remark1, ''), NULLIF(t.remark1, ''), NULLIF(c.remark1, '')),
        o.remark2 = COALESCE(NULLIF(o.remark2, ''), NULLIF(p.remark2, ''), NULLIF(t.remark2, ''), NULLIF(c.remark2, ''))
      WHERE o.remark1 IS NULL OR o.remark1 = '' OR o.remark2 IS NULL OR o.remark2 = ''
    `);

    for (const tableName of [
      "pickup_transport_tracking",
      "transfer",
      "customs_clearance_tracking",
    ]) {
      await connection.execute(`
        UPDATE ${tableName} legacy
        JOIN orders o ON o.serial_number = legacy.serial_number
        SET legacy.remark1 = o.remark1, legacy.remark2 = o.remark2
      `);
    }

    await connection.commit();
    console.log(`Unified order remarks migrated; orders matched: ${backfillResult.affectedRows}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
