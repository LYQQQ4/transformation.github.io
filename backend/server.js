require('dotenv').config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();

// 从环境变量读取配置，如果没有则使用默认值
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

const configuredCorsOrigin = (() => {
  if (process.env.CORS_ORIGIN) {
    const val = process.env.CORS_ORIGIN.trim();
    if (val === "*") return true;
    return val.split(',').map(origin => origin.trim()).filter(Boolean);
  }
  return defaultAllowedOrigins;
})();

const allowNullOrigin = process.env.ALLOW_NULL_ORIGIN !== 'false';

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (origin === 'null') {
      callback(null, allowNullOrigin);
      return;
    }

    if (configuredCorsOrigin === true) {
      callback(null, true);
      return;
    }

    if (configuredCorsOrigin.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // 限制请求体大小
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 安全头部
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Database connections - 从环境变量读取
const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "order_system",
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 0,
  ssl: process.env.DB_SSL === 'true' ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT) || 60000
};

const userDbConfig = {
  host: process.env.USER_DB_HOST || process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.USER_DB_PORT) || parseInt(process.env.DB_PORT) || 3306,
  user: process.env.USER_DB_USER || process.env.DB_USER || "root",
  password: process.env.USER_DB_PASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.USER_DB_NAME || "user_system",
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 0,
  ssl: process.env.DB_SSL === 'true' ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT) || 60000
};

const pool = mysql.createPool(dbConfig);
const userPool = mysql.createPool(userDbConfig);

// Test connections and start server
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("Connected to order_system database.");
    connection.release();
  } catch (err) {
    console.error("Error connecting to order_system database:", err.message);
  }

  try {
    const connection = await userPool.getConnection();
    console.log("Connected to user_system database.");
    connection.release();
  } catch (err) {
    console.error("Error connecting to user_system database:", err.message);
  }

  // Routes - moved inside async function
  app.get("/api/test", (req, res) => {
    res.json({ message: "API is working", timestamp: new Date().toISOString() });
  });

  // API routes
  app.use("/api/orders", require("./routes/orders")(pool, userPool));
  app.use("/api/packages", require("./routes/packages")(pool));
  app.use("/api/pickup-trackings", require("./routes/pickup_trackings")(pool));
  app.use("/api/transfers", require("./routes/transfer")(pool));
  app.use("/api/users", require("./routes/users")(userPool));
  app.use("/api/guests", require("./routes/guests")(userPool));
  app.use("/api/senders", require("./routes/senders")(userPool, pool));
  app.use("/api/customers", require("./routes/customers")(userPool, pool));
  app.use("/api/user-profiles", require("./routes/user_profiles")(userPool, pool));
  app.use("/api/products", require("./routes/products")(pool));
  app.use("/api/customs-clearance", require("./routes/customs_clearance")(pool));

  // Serve static files from frontend - AFTER API routes
  app.use(express.static(path.join(__dirname, "../frontend")));

  // Default route to serve frontend
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
  });

  // Start server after database connections are tested
  const server = app.listen(PORT, HOST, () => {
    console.log(`=================================`);
    console.log(`环境: ${NODE_ENV}`);
    console.log(`服务器运行在 http://${HOST}:${PORT}`);
    console.log(`服务器监听地址: ${server.address().address}:${server.address().port}`);
    console.log(`=================================`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
  });

  server.on('listening', () => {
    console.log('Server is now listening for connections');
  });
})();
