const mysql = require("mysql2/promise");

const dbConfig = {
  // Default to local MySQL when DB_HOST is not provided.
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  connectTimeout: 60000
};

async function waitForDatabase() {
  console.log("等待数据库就绪...");
  const maxRetries = 30;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const connection = await mysql.createConnection(dbConfig);
      await connection.ping();
      await connection.end();
      console.log("✅ 数据库已就绪！");
      return;
    } catch (error) {
      retries++;
      console.log(`⏳ 尝试连接数据库 (${retries}/${maxRetries})...`);
      if (retries >= maxRetries) {
        console.error("❌ 数据库连接失败，已达到最大重试次数");
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

waitForDatabase();
