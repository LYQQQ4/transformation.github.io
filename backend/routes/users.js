const bcrypt = require("bcryptjs");
const express = require("express");
const {
  SESSION_TTL_MS,
  createHttpError,
  createSessionToken,
  hashSessionToken,
  requireAdminSession,
  requireSelfOrAdmin,
  sendError,
  setSessionCookie
} = require("../lib/request_auth");

const router = express.Router();
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 60 * 1000;
const MAX_FAILURES = 5;
const BCRYPT_COST = 12;
const dummyHash = bcrypt.hashSync("not-a-real-user-password", BCRYPT_COST);

class LoginFailureLimiter {
  constructor({ now = Date.now, maxEntries = 10000 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.windowExpiresAt <= now && entry.lockedUntil <= now) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  isLocked(key) {
    this.prune();
    const entry = this.entries.get(key);
    return Boolean(entry && entry.lockedUntil > this.now());
  }

  fail(key) {
    this.prune();
    const now = this.now();
    const entry = this.entries.get(key);
    const next = !entry || entry.windowExpiresAt <= now
      ? { count: 1, windowExpiresAt: now + FAILED_WINDOW_MS, lockedUntil: 0 }
      : { ...entry, count: entry.count + 1 };
    if (next.count >= MAX_FAILURES) {
      next.lockedUntil = now + LOCK_MS;
    }
    this.entries.delete(key);
    this.entries.set(key, next);
    this.prune();
    return next;
  }

  clear(key) {
    this.entries.delete(key);
  }
}

const failureLimiter = new LoginFailureLimiter();

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 256) {
    throw createHttpError(400, "Password must be between 6 and 256 characters");
  }
  if (/^(.)\1+$/.test(password) || /^(password|qwerty|letmein|123456|admin)/i.test(password)) {
    throw createHttpError(400, "Choose a stronger password");
  }
}

function requestIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 128);
}

module.exports = (db) => {
  router.post("/login", async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const accountKey = `account:${username.toLowerCase() || "empty"}`;
    const ipKey = `ip:${requestIp(req)}`;
    const keys = [accountKey, ipKey];

    if (keys.some((key) => failureLimiter.isLocked(key))) {
      res.setHeader("Retry-After", String(Math.ceil(LOCK_MS / 1000)));
      res.status(429).json({ error: "Too many login attempts. Try again shortly." });
      return;
    }

    try {
      const [rows] = await db.execute(
        "SELECT id, username, password, password_hash, role, email FROM users WHERE username = ? LIMIT 1",
        [username]
      );
      const user = rows[0];
      let valid = false;
      if (user && user.password_hash) {
        valid = await bcrypt.compare(password, user.password_hash);
      } else if (user && typeof user.password === "string") {
        valid = password.length > 0 && user.password === password;
        if (valid) {
          const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
          await db.execute(
            "UPDATE users SET password_hash = ?, password = NULL WHERE id = ?",
            [passwordHash, user.id]
          );
        }
      } else {
        await bcrypt.compare(password || "invalid", dummyHash);
      }

      if (!valid) {
        failureLimiter.fail(accountKey);
        failureLimiter.fail(ipKey);
        console.warn("Login failed", {
          ip: requestIp(req),
          usernamePresent: Boolean(username)
        });
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }

      for (const key of keys) {
        failureLimiter.clear(key);
      }

      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await db.execute(
        `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
        [
          user.id,
          tokenHash,
          expiresAt,
          requestIp(req),
          String(req.get("user-agent") || "").slice(0, 512)
        ]
      );
      setSessionCookie(res, token);
      res.json({
        message: "Login successful",
        user: { id: user.id, username: user.username, role: user.role, email: user.email }
      });
    } catch (error) {
      if (error.statusCode) {
        sendError(res, error);
        return;
      }
      console.error("Login failed:", error.code || "database_error");
      res.status(500).json({ error: "Unable to complete login" });
    }
  });

  router.get("/", requireAdminSession, async (_req, res) => {
    try {
      const [rows] = await db.execute(
        "SELECT id, username, role, email, created_at, updated_at FROM users ORDER BY id"
      );
      res.json({ users: rows });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      requireSelfOrAdmin(req, req.params.id);
      const [rows] = await db.execute(
        "SELECT id, username, role, email, created_at, updated_at FROM users WHERE id = ?",
        [req.params.id]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ user: rows[0] });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/", requireAdminSession, (_req, res) => {
    res.status(405).json({ error: "User creation is disabled" });
  });

  router.put("/:id", async (req, res) => {
    try {
      requireSelfOrAdmin(req, req.params.id);
      const isAdmin = req.user.role === "admin";
      const fields = [];
      const values = [];

      if (typeof req.body?.username === "string") {
        const username = normalizeUsername(req.body.username);
        if (!username || username.length > 100) {
          throw createHttpError(400, "A valid username is required");
        }
        fields.push("username = ?");
        values.push(username);
      }
      if (typeof req.body?.email === "string" && isAdmin) {
        fields.push("email = ?");
        values.push(req.body.email.trim() || null);
      }
      if (req.body?.password !== undefined) {
        validatePassword(req.body.password);
        fields.push("password_hash = ?", "password = NULL");
        values.push(await bcrypt.hash(req.body.password, BCRYPT_COST));
      }
      if (Object.hasOwn(req.body || {}, "role") && !isAdmin) {
        throw createHttpError(403, "Only administrators may change roles");
      }
      if (Object.hasOwn(req.body || {}, "role")) {
        if (!["admin", "user"].includes(req.body.role)) {
          throw createHttpError(400, "Invalid role");
        }
        if (req.body.role === "user") {
          const [targetRows] = await db.execute(
            "SELECT role FROM users WHERE id = ? LIMIT 1",
            [req.params.id]
          );
          if (targetRows.length > 0 && targetRows[0].role === "admin") {
            const [adminRows] = await db.execute(
              "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"
            );
            if (Number(adminRows[0]?.count) <= 1) {
              throw createHttpError(400, "At least one administrator is required");
            }
          }
        }
        fields.push("role = ?");
        values.push(req.body.role);
      }
      if (fields.length === 0) {
        throw createHttpError(400, "No permitted fields to update");
      }
      values.push(req.params.id);
      const [result] = await db.execute(
        `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
        values
      );
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ message: "User updated successfully" });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        res.status(409).json({ error: "Username already exists" });
        return;
      }
      sendError(res, error);
    }
  });

  router.delete("/:id", requireAdminSession, async (req, res) => {
    try {
      if (String(req.user.id) === String(req.params.id)) {
        throw createHttpError(400, "Administrators cannot delete their own account");
      }
      await db.execute(
        "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
        [req.params.id]
      );
      const [result] = await db.execute("DELETE FROM users WHERE id = ?", [req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
};

module.exports.LoginFailureLimiter = LoginFailureLimiter;
module.exports.loginFailureLimiter = failureLimiter;
