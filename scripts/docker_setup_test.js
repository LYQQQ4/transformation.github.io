const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "setup_db_docker.js"),
  "utf8"
);

async function runSetup() {
  let database = null;
  let closed = false;
  const statements = [];
  const connection = {
    async changeUser(options) {
      database = options.database;
    },
    async execute(sql) {
      statements.push({ database, sql });
      if (sql.includes("SELECT COLUMN_NAME")) {
        return [[{ COLUMN_NAME: "existing_column" }]];
      }
      return [{}];
    },
    async end() {
      closed = true;
    }
  };

  await vm.runInNewContext(source, {
    require(name) {
      if (name === "dotenv") {
        return { config() {} };
      }
      assert.equal(name, "mysql2/promise");
      return { async createConnection() { return connection; } };
    },
    console: { log() {}, error() {} },
    process: {
      env: {
        NODE_ENV: "production",
        DB_PASSWORD: "test-only-not-a-real-password",
        DB_HOST: "test-only"
      },
      exit(code) {
        throw new Error(`Setup exited with code ${code}`);
      }
    }
  }, { filename: "setup_db_docker.js" });

  assert.ok(closed, "The database connection must be closed");
  const productStatements = statements.filter(
    ({ sql }) => /CREATE TABLE IF NOT EXISTS products\s*\(/.test(sql)
  );
  assert.equal(productStatements.length, 1);
  assert.equal(productStatements[0].database, "order_system");
  const productSql = productStatements[0].sql;
  for (const column of [
    "id", "product_id", "name_cn", "description_en", "hs_code",
    "declaration_elements", "origin", "remark", "created_at", "updated_at"
  ]) {
    assert.match(productSql, new RegExp(`\\b${column}\\s+`));
  }
  assert.match(productSql, /UNIQUE KEY uk_product_id \(product_id\)/);
  assert.match(productSql, /INDEX idx_name_cn \(name_cn\)/);
  assert.match(productSql, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/);
  assert.ok(
    statements.every(({ sql }) => !/\b(?:DROP|TRUNCATE|DELETE)\b/i.test(sql)),
    "Initialization must not delete existing data"
  );
}

(async () => {
  await runSetup();
  console.log("Docker setup products schema test passed (mock connection).");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
