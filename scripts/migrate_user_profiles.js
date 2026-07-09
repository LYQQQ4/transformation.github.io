require("dotenv").config();
const mysql = require("mysql2/promise");
const {
  buildDedupeKey,
  mapCustomerRecordToProfile,
  mapSenderRecordToProfile,
  mergeUserProfiles,
  normalizeCountryCode,
  normalizeText,
} = require("../backend/lib/user_profiles");

const userDbConfig = {
  host: process.env.USER_DB_HOST || process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.USER_DB_PORT || process.env.DB_PORT || "3306", 10),
  user: process.env.USER_DB_USER || process.env.DB_USER || "root",
  password: process.env.USER_DB_PASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.USER_DB_NAME || "user_system",
  ssl: process.env.DB_SSL === "true" ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "60000", 10),
};

const orderDbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "order_system",
  ssl: process.env.DB_SSL === "true" ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "60000", 10),
};

async function ensureUserProfilesSchema(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id VARCHAR(50) PRIMARY KEY COMMENT '用户ID，国家代码+编号',
      country_code VARCHAR(10) NOT NULL COMMENT '国家代码',
      sequence_no INT NOT NULL COMMENT '国家内顺序号',
      company_name VARCHAR(200) DEFAULT NULL COMMENT '公司名称',
      address TEXT DEFAULT NULL COMMENT '地址',
      contact_name VARCHAR(100) DEFAULT NULL COMMENT '联系人姓名',
      phone VARCHAR(50) DEFAULT NULL COMMENT '电话',
      email VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
      remark TEXT DEFAULT NULL COMMENT '备注',
      dedupe_key VARCHAR(255) DEFAULT NULL COMMENT '去重键',
      source_type VARCHAR(20) DEFAULT 'manual' COMMENT '来源类型',
      legacy_sender_id VARCHAR(50) DEFAULT NULL COMMENT '原发件人ID',
      legacy_customer_id VARCHAR(50) DEFAULT NULL COMMENT '原客户ID',
      migration_batch VARCHAR(32) DEFAULT NULL COMMENT '迁移批次',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_user_profiles_dedupe_key (dedupe_key),
      KEY idx_user_profiles_country_code (country_code),
      KEY idx_user_profiles_contact_name (contact_name),
      KEY idx_user_profiles_legacy_sender_id (legacy_sender_id),
      KEY idx_user_profiles_legacy_customer_id (legacy_customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='统一用户信息库'
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_profile_migration_map (
      legacy_type VARCHAR(20) NOT NULL COMMENT '旧类型 sender/customer',
      legacy_id VARCHAR(50) NOT NULL COMMENT '旧ID',
      user_profile_id VARCHAR(50) NOT NULL COMMENT '新用户ID',
      migration_batch VARCHAR(32) NOT NULL COMMENT '迁移批次',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      PRIMARY KEY (legacy_type, legacy_id),
      KEY idx_user_profile_id (user_profile_id),
      KEY idx_migration_batch (migration_batch)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户信息库迁移映射表'
  `);
}

async function getNextProfileId(db, countryCode) {
  const code = normalizeCountryCode(countryCode, "ch");
  const [rows] = await db.execute(
    "SELECT sequence_no FROM user_profiles WHERE country_code = ? ORDER BY sequence_no DESC LIMIT 1",
    [code]
  );
  const nextSequence = (rows[0]?.sequence_no || 0) + 1;
  return {
    id: `${code}${String(nextSequence).padStart(3, "0")}`,
    countryCode: code,
    sequenceNo: nextSequence,
  };
}

async function fetchProfileByLegacyId(db, legacyType, legacyId) {
  const field = legacyType === "sender" ? "legacy_sender_id" : "legacy_customer_id";
  const [rows] = await db.execute(`SELECT * FROM user_profiles WHERE ${field} = ?`, [legacyId]);
  return rows[0] || null;
}

async function fetchProfileByDedupeKey(db, dedupeKey) {
  if (!dedupeKey) {
    return null;
  }
  const [rows] = await db.execute("SELECT * FROM user_profiles WHERE dedupe_key = ?", [dedupeKey]);
  return rows[0] || null;
}

async function upsertMigratedProfile(db, profile, migrationBatch) {
  const dedupeKey = buildDedupeKey(profile);
  const legacyType = profile.legacy_sender_id ? "sender" : "customer";
  const legacyId = profile.legacy_sender_id || profile.legacy_customer_id;

  let existing = await fetchProfileByLegacyId(db, legacyType, legacyId);
  if (!existing && dedupeKey) {
    existing = await fetchProfileByDedupeKey(db, dedupeKey);
  }

  if (existing) {
    const merged = mergeUserProfiles(existing, {
      ...profile,
      migration_batch: migrationBatch,
    });

    await db.execute(
      `UPDATE user_profiles
          SET company_name = ?, address = ?, contact_name = ?, phone = ?, email = ?, remark = ?, dedupe_key = ?,
              source_type = ?, legacy_sender_id = ?, legacy_customer_id = ?, migration_batch = ?
        WHERE id = ?`,
      [
        merged.company_name,
        merged.address,
        merged.contact_name,
        merged.phone,
        merged.email,
        merged.remark,
        merged.dedupe_key,
        merged.source_type,
        merged.legacy_sender_id,
        merged.legacy_customer_id,
        merged.migration_batch,
        existing.id,
      ]
    );

    return { id: existing.id, action: "merged" };
  }

  const generated = await getNextProfileId(db, profile.country_code);
  await db.execute(
    `INSERT INTO user_profiles
      (id, country_code, sequence_no, company_name, address, contact_name, phone, email, remark, dedupe_key, source_type, legacy_sender_id, legacy_customer_id, migration_batch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generated.id,
      generated.countryCode,
      generated.sequenceNo,
      profile.company_name || null,
      profile.address || null,
      profile.contact_name || null,
      profile.phone || null,
      profile.email || null,
      profile.remark || null,
      dedupeKey,
      profile.source_type || "manual",
      profile.legacy_sender_id || null,
      profile.legacy_customer_id || null,
      migrationBatch,
    ]
  );

  return { id: generated.id, action: "created" };
}

async function saveMigrationMap(db, legacyType, legacyId, userProfileId, migrationBatch) {
  await db.execute(
    `INSERT INTO user_profile_migration_map (legacy_type, legacy_id, user_profile_id, migration_batch)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_profile_id = VALUES(user_profile_id), migration_batch = VALUES(migration_batch)`,
    [legacyType, legacyId, userProfileId, migrationBatch]
  );
}

async function updateOrders(orderDb, userDb) {
  const [senderMappings] = await userDb.execute(
    "SELECT legacy_id, user_profile_id FROM user_profile_migration_map WHERE legacy_type = 'sender'"
  );
  const [customerMappings] = await userDb.execute(
    "SELECT legacy_id, user_profile_id FROM user_profile_migration_map WHERE legacy_type = 'customer'"
  );

  let updatedSenders = 0;
  for (const mapping of senderMappings) {
    const [result] = await orderDb.execute(
      "UPDATE orders SET sender_id = ? WHERE sender_id = ?",
      [mapping.user_profile_id, mapping.legacy_id]
    );
    updatedSenders += result.affectedRows || 0;
  }

  let updatedCustomers = 0;
  for (const mapping of customerMappings) {
    const [result] = await orderDb.execute(
      "UPDATE orders SET customer_id = ? WHERE customer_id = ?",
      [mapping.user_profile_id, mapping.legacy_id]
    );
    updatedCustomers += result.affectedRows || 0;
  }

  return { updatedSenders, updatedCustomers };
}

async function main() {
  const userDb = await mysql.createConnection(userDbConfig);
  const orderDb = await mysql.createConnection(orderDbConfig);
  const migrationBatch = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

  try {
    await ensureUserProfilesSchema(userDb);

    const [senders] = await userDb.execute("SELECT * FROM sender_info ORDER BY sender_id ASC");
    const [customers] = await userDb.execute("SELECT * FROM customer_info ORDER BY customer_id ASC");

    let created = 0;
    let merged = 0;

    for (const sender of senders) {
      const profile = mapSenderRecordToProfile(sender, migrationBatch);
      const result = await upsertMigratedProfile(userDb, profile, migrationBatch);
      await saveMigrationMap(userDb, "sender", sender.sender_id, result.id, migrationBatch);
      if (result.action === "created") {
        created += 1;
      } else {
        merged += 1;
      }
    }

    for (const customer of customers) {
      const profile = mapCustomerRecordToProfile(customer, migrationBatch);
      const result = await upsertMigratedProfile(userDb, profile, migrationBatch);
      await saveMigrationMap(userDb, "customer", customer.customer_id, result.id, migrationBatch);
      if (result.action === "created") {
        created += 1;
      } else {
        merged += 1;
      }
    }

    const orderUpdateResult = await updateOrders(orderDb, userDb);

    const [profileCountRows] = await userDb.execute("SELECT COUNT(*) AS total FROM user_profiles");
    const [mapCountRows] = await userDb.execute("SELECT COUNT(*) AS total FROM user_profile_migration_map");

    console.log("Migration completed");
    console.log(`migration_batch=${migrationBatch}`);
    console.log(`user_profiles_total=${profileCountRows[0].total}`);
    console.log(`migration_map_total=${mapCountRows[0].total}`);
    console.log(`created=${created}`);
    console.log(`merged=${merged}`);
    console.log(`orders_customer_updated=${orderUpdateResult.updatedCustomers}`);
    console.log(`orders_sender_updated=${orderUpdateResult.updatedSenders}`);
  } finally {
    await userDb.end();
    await orderDb.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
