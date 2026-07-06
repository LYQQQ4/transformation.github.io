require('dotenv').config();
const mysql = require("mysql2/promise");

async function addCustomsClearanceTable() {
  // 从环境变量读取数据库配置，如果没有则使用默认值
  const dbHost = process.env.DB_HOST || "localhost";
  const dbPort = parseInt(process.env.DB_PORT) || 3306;
  const dbUser = process.env.DB_USER || "root";
  const dbPassword = process.env.DB_PASSWORD || "Sidel!2345";
  const dbName = process.env.DB_NAME || "order_system";

  let connection;

  try {
    connection = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      ssl: false,
      connectTimeout: 60000
    });

    console.log(`连接到数据库 ${dbName}...`);

    // 检查表是否已存在
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'customs_clearance_tracking'"
    );

    if (tables.length > 0) {
      console.log("✓ 表 customs_clearance_tracking 已存在，无需创建");
    } else {
      // 创建报关信息维护跟踪表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS customs_clearance_tracking (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
          serial_number VARCHAR(50) NOT NULL COMMENT '流水号',
          customs_start_time DATETIME DEFAULT NULL COMMENT '开始报关时间',
          tax_payment_time DATETIME DEFAULT NULL COMMENT '付税时间',
          release_time DATETIME DEFAULT NULL COMMENT '放行时间',
          customs_declaration_number VARCHAR(100) DEFAULT NULL COMMENT '报关单号',
          customs_supplier VARCHAR(200) DEFAULT NULL COMMENT '报关供应商',
          remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
          remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          INDEX idx_serial_number (serial_number),
          INDEX idx_customs_start_time (customs_start_time)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报关信息维护跟踪表'
      `);
      console.log("✓ 表 customs_clearance_tracking 创建成功");
    }

    console.log("\n✅ 数据库更新完成！");
  } catch (error) {
    console.error("❌ 数据库更新失败:", error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

addCustomsClearanceTable();
