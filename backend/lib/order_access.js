const { createHttpError, sendError } = require("./request_auth");

const COMPANY_NAME_MAX_LENGTH = 200;
// The SQL pattern is the exact ECMAScript trim character set, encoded without
// SQL backslash escapes so NO_BACKSLASH_ESCAPES does not change its meaning.
const trimCharacters = "\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
const trimPatternHex = Buffer.from(`^[${trimCharacters}]+|[${trimCharacters}]+$`, "utf8").toString("hex");

function normalizeCompanyName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateCompanyName(value) {
  const name = normalizeCompanyName(value);
  if (!name || [...name].length > COMPANY_NAME_MAX_LENGTH || name.includes("\0")) {
    throw createHttpError(400, "Company name must contain 1 to 200 characters");
  }
  return name;
}

function normalizedCompanySql(column) {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(column)) {
    throw new Error("Invalid internal company column");
  }
  return `REGEXP_REPLACE(COALESCE(${column}, ''), CONVERT(0x${trimPatternHex} USING utf8mb4), '')`;
}

function createOrderAccess(user, companies = []) {
  if (!user) throw createHttpError(401, "Authentication required");
  const isAdmin = user.role === "admin";
  const names = [...new Set(companies.map(normalizeCompanyName).filter(Boolean))];
  const allowed = new Set(names);
  return {
    isAdmin,
    params: isAdmin ? [] : names,
    sql(column = "o.company_name") {
      if (isAdmin) return "1 = 1";
      if (!names.length) return "1 = 0";
      return `CAST(${normalizedCompanySql(column)} AS BINARY) IN (${names.map(() => "CAST(? AS BINARY)").join(", ")})`;
    },
    assertCompany(value) {
      const name = validateCompanyName(value);
      if (!isAdmin && !allowed.has(name)) {
        throw createHttpError(403, "No order access for this company");
      }
      return name;
    },
  };
}

function loadOrderAccess(userDb) {
  return async (req, res, next) => {
    try {
      if (!req.user) throw createHttpError(401, "Authentication required");
      let companies = [];
      if (req.user.role !== "admin") {
        if (!userDb) throw createHttpError(503, "Order permission service unavailable");
        const [rows] = await userDb.execute(
          "SELECT company_name FROM user_order_companies WHERE user_id = ? ORDER BY company_name",
          [req.user.id]
        );
        companies = rows.map((row) => row.company_name);
      }
      req.orderAccess = createOrderAccess(req.user, companies);
      next();
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        console.error("Order permission lookup failed:", error.code || error.statusCode || "database_error");
      }
      sendError(res, error, "Unable to load order permissions");
    }
  };
}

async function assertOrderSerialAccess(db, access, serialNumber, { lock = false } = {}) {
  const [rows] = await db.execute(
    `SELECT o.id, o.serial_number, o.company_name FROM orders o
     WHERE o.serial_number = ? AND (${access.sql()}) LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [serialNumber, ...access.params]
  );
  if (!rows.length) throw createHttpError(404, "Order not found");
  return rows[0];
}

function validateChildTable(table) {
  if (!["package", "transfer", "pickup_transport_tracking", "customs_clearance_tracking", "billing_info"].includes(table)) {
    throw new Error("Invalid internal order child table");
  }
}

async function assertOrderChildAccess(db, access, table, id, { lock = false } = {}) {
  validateChildTable(table);
  const [rows] = await db.execute(
    `SELECT o.id FROM \`${table}\` child
     INNER JOIN orders o ON o.serial_number = child.serial_number
     WHERE child.id = ? AND (${access.sql()}) LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id, ...access.params]
  );
  if (!rows.length) throw createHttpError(404, "Order not found");
}

// Protect ID-based and serial-based writes in child modules as well as SQL
// filtering their read endpoints. Excel imports validate each parsed row.
function guardRelatedOrderWrites(db, table) {
  validateChildTable(table);
  return async (req, res, next) => {
    try {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
      const serialMatch = req.path.match(/^\/serial\/([^/]+)\/?$/i);
      const reserved = new Set(["/batch-date", "/import-excel", "/parse-excel", "/box-types", "/import-template", "/export", "/import"]);
      const idMatch = reserved.has(req.path.replace(/\/$/, "").toLowerCase()) ? null : req.path.match(/^\/([^/]+)\/?$/);
      if (serialMatch) {
        await assertOrderSerialAccess(db, req.orderAccess, decodeURIComponent(serialMatch[1]));
      } else if (idMatch) {
        await assertOrderChildAccess(db, req.orderAccess, table, decodeURIComponent(idMatch[1]));
      }
      if ((idMatch || req.path === "/") && req.body?.serial_number) {
        await assertOrderSerialAccess(db, req.orderAccess, req.body.serial_number);
      } else if (req.path === "/" && !req.orderAccess.isAdmin) {
        throw createHttpError(400, "serial_number is required");
      }
      next();
    } catch (error) {
      sendError(res, error, "Unable to check order permissions");
    }
  };
}

module.exports = {
  COMPANY_NAME_MAX_LENGTH,
  assertOrderChildAccess,
  assertOrderSerialAccess,
  createOrderAccess,
  guardRelatedOrderWrites,
  loadOrderAccess,
  normalizeCompanyName,
  normalizedCompanySql,
  validateCompanyName,
};
