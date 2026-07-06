const mysql = require("mysql2/promise");

async function addUser() {
  let connection;

  try {
    // 连接到user_system数据库
    connection = await mysql.createConnection({
      host: "localhost",
      port: 3306,
      user: "root",
      password: "Sidel!2345",
      database: "user_system",
      ssl: false,
      connectTimeout: 60000
    });

    console.log("Connected to user_system database.");

    // 首先检查users表是否存在，如果不存在则创建
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255),
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log("Users table ensured.");

    // 插入用户
    const [result] = await connection.execute(
      "INSERT INTO users (username, password, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP",
      ["林彦琦", "123456", "user"]
    );

    if (result.affectedRows > 0) {
      console.log("User added/updated successfully:", {
        id: result.insertId,
        username: "林彦琦"
      });
    } else {
      console.log("User already exists and was updated.");
    }

    // 验证用户
    const [rows] = await connection.execute("SELECT id, username, role, created_at FROM users WHERE username = ?", ["林彦琦"]);
    console.log("User verification:", rows[0]);

  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log("Connection closed.");
    }
  }
}

addUser();
