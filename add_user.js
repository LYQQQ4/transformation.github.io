require("dotenv").config();
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

async function addUser() {
  const username = process.env.NEW_USERNAME?.trim();
  const password = process.env.NEW_USER_PASSWORD;
  const role = process.env.NEW_USER_ROLE === "admin" ? "admin" : "user";
  if (
    !username ||
    !password ||
    password.length < 12 ||
    password.length > 256 ||
    /^(.)\1+$/.test(password) ||
    /^(password|qwerty|letmein|123456|admin)/i.test(password)
  ) {
    throw new Error("Set NEW_USERNAME and a strong NEW_USER_PASSWORD (at least 12 characters)");
  }

  const dbName = process.env.USER_DB_NAME || "user_system";
  if (process.env.NODE_ENV === "production" && dbName !== "user_system") {
    throw new Error("Refusing unexpected production user database");
  }
  const connection = await mysql.createConnection({
    host: process.env.USER_DB_HOST || process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.USER_DB_PORT || process.env.DB_PORT || 3306),
    user: process.env.USER_DB_USER || process.env.DB_USER || "root",
    password: process.env.USER_DB_PASSWORD || process.env.DB_PASSWORD || "",
    database: dbName
  });
  try {
    const hash = await bcrypt.hash(password, 12);
    await connection.execute(
      "INSERT INTO users (username, password_hash, password, role) VALUES (?, ?, NULL, ?)",
      [username, hash, role]
    );
    console.log("User created.");
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  addUser().catch((error) => {
    console.error("User creation failed:", error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { addUser };
