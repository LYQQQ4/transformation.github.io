const mysql = require("mysql2/promise");

// 数据库配置
const dbConfig = {
  host: "localhost",
  port: 3306,
  user: "root",
  password: "Sidel!2345",
  database: "user_system"
};

async function checkUsers() {
  let connection = null;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log("✅ 连接到 user_system 数据库");

    // 查询所有用户
    const [users] = await connection.execute("SELECT id, username, password, role FROM users");
    console.log("\n👥 用户列表:");
    console.log("=".repeat(60));

    users.forEach(user => {
      console.log(`ID: ${user.id}`);
      console.log(`用户名: ${user.username}`);
      console.log(`密码: ${user.password}`);
      console.log(`角色: ${user.role}`);
      console.log("-".repeat(30));
    });

    console.log(`\n📊 总用户数: ${users.length}`);

  } catch (error) {
    console.error("❌ 数据库查询错误:", error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkUsers();
