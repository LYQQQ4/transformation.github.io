const crypto = require("crypto");

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "transport_session";
const SESSION_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.SESSION_TTL_MS) || 8 * 60 * 60 * 1000
);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      continue;
    }
  }
  return cookies;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS
  };
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  parts.push(`Path=${options.path}`);
  parts.push(`SameSite=${options.sameSite}`);
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions())
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE_NAME, "", {
      ...getSessionCookieOptions(),
      maxAge: 0
    })
  );
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || "";
}

async function loadSession(userDb, req, _res, next) {
  req.user = null;
  req.session = null;

  const token = getSessionToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const tokenHash = hashSessionToken(token);
    const [rows] = await userDb.execute(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at,
              u.username, u.role, u.email
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [tokenHash]
    );

    if (rows.length > 0) {
      req.user = {
        id: rows[0].user_id,
        username: rows[0].username,
        role: rows[0].role,
        email: rows[0].email
      };
      req.session = {
        id: rows[0].session_id,
        tokenHash,
        expiresAt: rows[0].expires_at
      };
      await userDb.execute(
        "UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
        [rows[0].session_id]
      );
    } else {
      clearSessionCookie(_res);
    }
  } catch (error) {
    console.error("Session lookup failed:", error.code || "database_error");
    next(createHttpError(503, "Authentication service unavailable"));
    return;
  }

  next();
}

function requireSession(req, _res, next) {
  if (!req.user) {
    next(createHttpError(401, "Authentication required"));
    return;
  }
  next();
}

function requireAdminSession(req, _res, next) {
  if (!req.user) {
    next(createHttpError(401, "Authentication required"));
    return;
  }
  if (req.user.role !== "admin") {
    next(createHttpError(403, "Administrator access required"));
    return;
  }
  next();
}

function getRequestUserId(req) {
  return req.user ? String(req.user.id) : "";
}

async function requireAdminAccess(_userDb, req, featureName = "该功能") {
  if (!req.user) {
    throw createHttpError(401, `请先登录后再使用${featureName}`);
  }
  if (req.user.role !== "admin") {
    throw createHttpError(403, `${featureName}仅管理员可操作`);
  }
  return req.user;
}

async function requireUserAccess(_userDb, req, featureName = "该功能") {
  if (!req.user) {
    throw createHttpError(401, `请先登录后再使用${featureName}`);
  }
  return req.user;
}

function requireSelfOrAdmin(req, targetUserId, featureName = "该用户") {
  if (!req.user) {
    throw createHttpError(401, "Authentication required");
  }
  if (req.user.role !== "admin" && String(req.user.id) !== String(targetUserId)) {
    throw createHttpError(403, `无权访问${featureName}`);
  }
  return req.user;
}

function sendError(res, error, fallback = "Internal server error") {
  const statusCode = Number(error?.statusCode) || 500;
  res.status(statusCode).json({
    error: statusCode >= 500 ? fallback : error.message
  });
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  clearSessionCookie,
  createHttpError,
  createSessionToken,
  getRequestUserId,
  getSessionToken,
  hashSessionToken,
  loadSession,
  requireAdminAccess,
  requireAdminSession,
  requireSelfOrAdmin,
  requireSession,
  requireUserAccess,
  sendError,
  setSessionCookie
};
