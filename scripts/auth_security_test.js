const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const express = require("express");
const bcrypt = require("bcryptjs");
process.env.NODE_ENV = "test";

const usersRouter = require("../backend/routes/users");
const authRouter = require("../backend/routes/auth");
const {
  loadSession,
  requireSession,
  hashSessionToken
} = require("../backend/lib/request_auth");

const generatedPassword = `Local-Test-${Date.now()}-NotASecret`;

function createFakeDb() {
  const userList = [
    { id: 1, username: "operator", role: "user", email: null, password: null, password_hash: null },
    { id: 2, username: "admin", role: "admin", email: null, password: null, password_hash: null }
  ];
  const sessions = new Map();

  return {
    userList,
    sessions,
    async execute(sql, values = []) {
      if (sql.startsWith("SELECT id, username, password, password_hash")) {
        return [[userList.find((user) => user.username === values[0])].filter(Boolean)];
      }
      if (sql.startsWith("INSERT INTO sessions")) {
        const [userId, tokenHash, expiresAt] = values;
        sessions.set(tokenHash, {
          id: sessions.size + 1,
          user_id: userId,
          expires_at: new Date(expiresAt),
          revoked_at: null
        });
        return [{ insertId: sessions.size }];
      }
      if (sql.includes("FROM sessions s")) {
        const session = sessions.get(values[0]);
        if (!session || session.revoked_at || session.expires_at <= new Date()) {
          return [[]];
        }
        const user = userList.find((candidate) => candidate.id === session.user_id);
        return [[{
          session_id: session.id,
          user_id: user.id,
          expires_at: session.expires_at,
          revoked_at: null,
          username: user.username,
          role: user.role,
          email: user.email
        }]];
      }
      if (sql.startsWith("UPDATE sessions SET last_seen_at")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE sessions SET revoked_at")) {
        const session = sessions.get(values[0]);
        if (session) {
          session.revoked_at = new Date();
        }
        return [{ affectedRows: session ? 1 : 0 }];
      }
      if (sql.startsWith("SELECT id, username, role, email, created_at, updated_at")) {
        return [[userList.map(({ id, username, role, email }) => ({ id, username, role, email }))]];
      }
      throw new Error(`Unexpected test query: ${sql}`);
    }
  };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_error) {
    body = { raw: text.slice(0, 120) };
  }
  return {
    response,
    body
  };
}

async function login(baseUrl, username, password) {
  const result = await request(baseUrl, "/api/users/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return {
    ...result,
    cookie: result.response.headers.get("set-cookie")?.split(";")[0]
  };
}

async function run() {
  const { LoginFailureLimiter } = usersRouter;
  let clock = 0;
  const limiterProbe = new LoginFailureLimiter({ now: () => clock, maxEntries: 2 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    limiterProbe.fail("account:expiring");
  }
  assert.equal(limiterProbe.isLocked("account:expiring"), true);
  clock = 60 * 1000 + 1;
  assert.equal(limiterProbe.isLocked("account:expiring"), false, "lockout expires automatically");
  limiterProbe.fail("one");
  limiterProbe.fail("two");
  limiterProbe.fail("three");
  assert.equal(limiterProbe.entries.size, 2, "limiter storage remains bounded");
  limiterProbe.clear("ip:127.0.0.1");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    limiterProbe.fail("ip:127.0.0.1");
  }
  assert.equal(limiterProbe.isLocked("ip:127.0.0.1"), true, "repeated IP failures are locked");

  const db = createFakeDb();
  for (const user of db.userList) {
    user.password_hash = await bcrypt.hash(generatedPassword, 4);
  }
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => loadSession(db, req, res, next));
  app.use("/api/auth", authRouter(db));
  app.use("/api/users", usersRouter(db));
  app.get("/api/orders", requireSession, (_req, res) => res.json({ ok: true }));
  const { server, baseUrl } = await listen(app);

  try {
    const registration = await request(baseUrl, "/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "injected", password: generatedPassword, role: "admin" })
    });
    assert.equal(registration.response.status, 403, "anonymous registration must be denied");

    const anonymousBusiness = await request(baseUrl, "/api/orders", {
      headers: { "x-user-id": "2" }
    });
    assert.equal(anonymousBusiness.response.status, 401, "x-user-id must not authenticate");

    const wrong = await login(baseUrl, "operator", "incorrect");
    const absent = await login(baseUrl, "missing-user", "incorrect");
    assert.equal(wrong.response.status, 401);
    assert.equal(absent.response.status, 401);
    assert.equal(wrong.body.error, absent.body.error, "unknown user and wrong password must match");

    const valid = await login(baseUrl, "operator", generatedPassword);
    assert.equal(valid.response.status, 200, "valid credentials must login");
    assert.ok(valid.cookie);
    assert.equal(db.sessions.has(hashSessionToken(decodeURIComponent(valid.cookie.split("=")[1]))), true);

    const business = await request(baseUrl, "/api/orders", { headers: { Cookie: valid.cookie } });
    assert.equal(business.response.status, 200);

    const regularAdminRoute = await request(baseUrl, "/api/users", {
      headers: { Cookie: valid.cookie, "x-user-id": "2" }
    });
    assert.equal(regularAdminRoute.response.status, 403);

    const adminLogin = await login(baseUrl, "admin", generatedPassword);
    const userList = await request(baseUrl, "/api/users", { headers: { Cookie: adminLogin.cookie } });
    assert.equal(userList.response.status, 200);
    assert.ok(userList.body.users.every((user) => !("password" in user) && !("password_hash" in user)));

    const logout = await request(baseUrl, "/api/auth/logout", {
      method: "POST",
      headers: { Cookie: valid.cookie }
    });
    assert.equal(logout.response.status, 200);
    const afterLogout = await request(baseUrl, "/api/auth/me", { headers: { Cookie: valid.cookie } });
    assert.equal(afterLogout.response.status, 401);

    const expired = await login(baseUrl, "operator", generatedPassword);
    const expiredTokenHash = hashSessionToken(decodeURIComponent(expired.cookie.split("=")[1]));
    db.sessions.get(expiredTokenHash).expires_at = new Date(Date.now() - 1000);
    const afterExpiry = await request(baseUrl, "/api/auth/me", { headers: { Cookie: expired.cookie } });
    assert.equal(afterExpiry.response.status, 401);

    const limiter = usersRouter.loginFailureLimiter;
    const ipKey = "ip:127.0.0.1";
    const accountKey = "account:operator";
    limiter.clear(ipKey);
    limiter.clear(accountKey);
    await login(baseUrl, "operator", "incorrect-once");
    assert.equal(limiter.isLocked(accountKey), false);
    const recoveredLogin = await login(baseUrl, "operator", generatedPassword);
    assert.equal(recoveredLogin.response.status, 200);
    assert.equal(limiter.isLocked(accountKey), false, "successful login clears account failure state");
    assert.equal(limiter.isLocked(ipKey), false, "successful login clears IP failure state");

    limiter.clear("account:locked-test");
    limiter.clear(ipKey);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(baseUrl, "locked-test", "incorrect");
    }
    assert.equal(limiter.isLocked("account:locked-test"), true, "repeated failures lock an account");

    const serverPath = require("node:path").resolve(__dirname, "../backend/server.js");
    const envWithoutPassword = {
      ...process.env,
      NODE_ENV: "production",
      CORS_ORIGIN: "https://orders.example.test",
      DOTENV_CONFIG_PATH: require("node:path").join(require("node:os").tmpdir(), "auth-test-no-dotenv")
    };
    delete envWithoutPassword.DB_PASSWORD;
    delete envWithoutPassword.MYSQL_ROOT_PASSWORD;
    assert.throws(() => execFileSync(process.execPath, ["-e", `require(${JSON.stringify(serverPath)})`], {
      env: envWithoutPassword,
      cwd: require("node:os").tmpdir(),
      stdio: "ignore"
    }), "production must fail startup without a database password");

    assert.throws(() => execFileSync(process.execPath, ["-e", `require(${JSON.stringify(serverPath)})`], {
      env: {
        ...envWithoutPassword,
        DB_PASSWORD: "test-only-not-a-credential",
        CORS_ORIGIN: "*"
      },
      cwd: require("node:os").tmpdir(),
      stdio: "ignore"
    }), "production must reject wildcard CORS");

    console.log("Authentication security tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().catch((error) => {
  console.error("Authentication security tests failed:", error.message);
  process.exitCode = 1;
});
