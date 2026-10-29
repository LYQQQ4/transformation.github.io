require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const path = require("path");
const { migrateAuthSchema } = require("../scripts/migrate_auth_sessions");
const { loadSession, requireSession, sendError } = require("./lib/request_auth");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

function requiredProductionValue(name, value) {
  if (isProduction && (!value || !String(value).trim())) {
    throw new Error(`${name} must be set in production`);
  }
  return value || "";
}

const dbPassword = requiredProductionValue(
  "DB_PASSWORD or MYSQL_ROOT_PASSWORD",
  process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD
);
const userDbPassword = requiredProductionValue(
  "USER_DB_PASSWORD or DB_PASSWORD",
  process.env.USER_DB_PASSWORD || process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD
);
const rawCorsOrigin = requiredProductionValue("CORS_ORIGIN", process.env.CORS_ORIGIN);
if (isProduction && rawCorsOrigin === "*") {
  throw new Error("CORS_ORIGIN=* is forbidden in production");
}

const configuredCorsOrigins = (rawCorsOrigin || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowNullOrigin = process.env.ALLOW_NULL_ORIGIN === "true";

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (origin === "null") {
      callback(null, allowNullOrigin);
      return;
    }
    callback(null, configuredCorsOrigins.includes(origin));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: dbPassword,
  database: process.env.DB_NAME || "order_system",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: Number(process.env.DB_QUEUE_LIMIT || 0),
  ssl: process.env.DB_SSL === "true" ? {} : false,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 60000)
};
const userDbConfig = {
  ...dbConfig,
  host: process.env.USER_DB_HOST || dbConfig.host,
  port: Number(process.env.USER_DB_PORT || dbConfig.port),
  user: process.env.USER_DB_USER || dbConfig.user,
  password: userDbPassword,
  database: process.env.USER_DB_NAME || "user_system"
};

const pool = mysql.createPool(dbConfig);
const userPool = mysql.createPool(userDbConfig);

app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  const json = res.json.bind(res);
  res.json = function sanitizedJson(body) {
    if (res.statusCode >= 500 && body && typeof body === "object" && body.error) {
      return json({ ...body, error: "Internal server error" });
    }
    return json(body);
  };
  next();
});
app.use((req, res, next) => loadSession(userPool, req, res, next));

app.get("/api/test", (_req, res) => {
  res.json({ message: "API is working", timestamp: new Date().toISOString() });
});
app.use("/api/auth", require("./routes/auth")(userPool));
app.use("/api/users", require("./routes/users")(userPool));

const protectedRoutes = [
  ["/api/orders", require("./routes/orders")(pool, userPool)],
  ["/api/packages", require("./routes/packages")(pool)],
  ["/api/pickup-trackings", require("./routes/pickup_trackings")(pool, userPool)],
  ["/api/transfers", require("./routes/transfer")(pool, userPool)],
  ["/api/guests", require("./routes/guests")(userPool)],
  ["/api/senders", require("./routes/senders")(userPool, pool)],
  ["/api/customers", require("./routes/customers")(userPool, pool)],
  ["/api/user-profiles", require("./routes/user_profiles")(userPool, pool)],
  ["/api/input-memory", require("./routes/input_memory")(pool, userPool)],
  ["/api/products", require("./routes/products")(pool)],
  ["/api/customs-clearance", require("./routes/customs_clearance")(pool, userPool)],
  ["/api/billing", require("./routes/billing")(pool, userPool)],
  ["/api/reports", require("./routes/reports")(pool, userPool)]
];
for (const [route, handler] of protectedRoutes) {
  app.use(route, requireSession, handler);
}

app.use(express.static(path.join(__dirname, "../frontend")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use((error, _req, res, next) => {
  void next;
  sendError(res, error);
});

async function verifyDatabase(poolToCheck, name) {
  const connection = await poolToCheck.getConnection();
  connection.release();
  console.log(`Connected to ${name} database.`);
}

async function start() {
  await verifyDatabase(pool, "order_system");
  await verifyDatabase(userPool, "user_system");
  const migrationConnection = await mysql.createConnection(userDbConfig);
  try {
    await migrateAuthSchema(migrationConnection, userDbConfig.database);
  } finally {
    await migrationConnection.end();
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
  server.on("error", (error) => {
    console.error("Server error:", error.code || "server_error");
    process.exitCode = 1;
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Application startup failed:", error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, start };
