const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const {
  mergeUserProfiles,
  normalizeCountryCode,
  normalizeUserProfileExcelRow,
  normalizeUserProfilePayload,
  validateUserProfileId,
} = require("../lib/user_profiles");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error("Only .xls and .xlsx files are allowed"));
  },
});

async function ensureUserProfilesTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id VARCHAR(50) PRIMARY KEY,
      country_code VARCHAR(10) NOT NULL,
      sequence_no INT NOT NULL,
      company_name VARCHAR(200) DEFAULT NULL,
      address TEXT DEFAULT NULL,
      contact_name VARCHAR(100) DEFAULT NULL,
      phone VARCHAR(50) DEFAULT NULL,
      email VARCHAR(100) DEFAULT NULL,
      remark TEXT DEFAULT NULL,
      dedupe_key VARCHAR(255) DEFAULT NULL,
      source_type VARCHAR(20) DEFAULT 'manual',
      legacy_sender_id VARCHAR(50) DEFAULT NULL,
      legacy_customer_id VARCHAR(50) DEFAULT NULL,
      migration_batch VARCHAR(32) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_profiles_dedupe_key (dedupe_key),
      KEY idx_user_profiles_country_code (country_code),
      KEY idx_user_profiles_company_name (company_name),
      KEY idx_user_profiles_contact_name (contact_name),
      KEY idx_user_profiles_legacy_sender_id (legacy_sender_id),
      KEY idx_user_profiles_legacy_customer_id (legacy_customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function fetchProfileOrNull(db, id) {
  const [rows] = await db.execute("SELECT * FROM user_profiles WHERE id = ?", [id]);
  return rows[0] || null;
}

async function findProfileByDedupeKey(db, dedupeKey, excludeId = null) {
  if (!dedupeKey) {
    return null;
  }

  const params = [dedupeKey];
  let sql = "SELECT * FROM user_profiles WHERE dedupe_key = ?";
  if (excludeId) {
    sql += " AND id <> ?";
    params.push(excludeId);
  }

  const [rows] = await db.execute(sql, params);
  return rows[0] || null;
}

async function generateNextProfileId(db, countryCode) {
  const code = normalizeCountryCode(countryCode, "ch");
  const [rows] = await db.execute(
    "SELECT sequence_no FROM user_profiles WHERE country_code = ? ORDER BY sequence_no DESC LIMIT 1",
    [code]
  );

  const sequenceNo = (rows[0]?.sequence_no || 0) + 1;
  return {
    id: `${code}${String(sequenceNo).padStart(3, "0")}`,
    countryCode: code,
    sequenceNo,
  };
}

async function createProfile(db, rawProfile) {
  const profile = normalizeUserProfilePayload(rawProfile);
  if (profile.id && !validateUserProfileId(profile.id)) {
    const error = new Error("User ID must be country code + numeric sequence, for example ch001");
    error.statusCode = 400;
    throw error;
  }

  const duplicate = await findProfileByDedupeKey(db, profile.dedupe_key);
  if (duplicate) {
    const error = new Error(`Duplicate user profile detected: ${duplicate.id}`);
    error.statusCode = 400;
    throw error;
  }

  let finalProfile = { ...profile };
  if (!finalProfile.id) {
    const generated = await generateNextProfileId(db, finalProfile.country_code);
    finalProfile.id = generated.id;
    finalProfile.country_code = generated.countryCode;
    finalProfile.sequence_no = generated.sequenceNo;
  } else {
    finalProfile.country_code = normalizeCountryCode(finalProfile.id.slice(0, 2), finalProfile.country_code);
    finalProfile.sequence_no = parseInt(finalProfile.id.slice(2), 10);
  }

  await db.execute(
    `INSERT INTO user_profiles
      (id, country_code, sequence_no, company_name, address, contact_name, phone, email, remark, dedupe_key, source_type, legacy_sender_id, legacy_customer_id, migration_batch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      finalProfile.id,
      finalProfile.country_code,
      finalProfile.sequence_no,
      finalProfile.company_name,
      finalProfile.address,
      finalProfile.contact_name,
      finalProfile.phone,
      finalProfile.email,
      finalProfile.remark,
      finalProfile.dedupe_key,
      finalProfile.source_type,
      finalProfile.legacy_sender_id,
      finalProfile.legacy_customer_id,
      finalProfile.migration_batch,
    ]
  );

  return finalProfile;
}

async function updateProfile(db, id, rawProfile) {
  const existing = await fetchProfileOrNull(db, id);
  if (!existing) {
    const error = new Error("User profile not found");
    error.statusCode = 404;
    throw error;
  }

  const nextProfile = normalizeUserProfilePayload({ ...existing, ...rawProfile, id });
  if (!validateUserProfileId(nextProfile.id)) {
    const error = new Error("User ID must be country code + numeric sequence, for example ch001");
    error.statusCode = 400;
    throw error;
  }

  const duplicate = await findProfileByDedupeKey(db, nextProfile.dedupe_key, id);
  if (duplicate) {
    const error = new Error(`Duplicate user profile detected: ${duplicate.id}`);
    error.statusCode = 400;
    throw error;
  }

  nextProfile.country_code = normalizeCountryCode(nextProfile.id.slice(0, 2), nextProfile.country_code);
  nextProfile.sequence_no = parseInt(nextProfile.id.slice(2), 10);

  await db.execute(
    `UPDATE user_profiles
        SET country_code = ?, sequence_no = ?, company_name = ?, address = ?, contact_name = ?, phone = ?,
            email = ?, remark = ?, dedupe_key = ?, source_type = ?, legacy_sender_id = ?, legacy_customer_id = ?, migration_batch = ?
      WHERE id = ?`,
    [
      nextProfile.country_code,
      nextProfile.sequence_no,
      nextProfile.company_name,
      nextProfile.address,
      nextProfile.contact_name,
      nextProfile.phone,
      nextProfile.email,
      nextProfile.remark,
      nextProfile.dedupe_key,
      nextProfile.source_type,
      nextProfile.legacy_sender_id,
      nextProfile.legacy_customer_id,
      nextProfile.migration_batch,
      id,
    ]
  );

  return nextProfile;
}

async function importProfile(db, rawProfile) {
  const normalized = normalizeUserProfilePayload(rawProfile);
  const existingById = normalized.id ? await fetchProfileOrNull(db, normalized.id) : null;
  const existingByDedupeKey = normalized.dedupe_key
    ? await findProfileByDedupeKey(db, normalized.dedupe_key, normalized.id || null)
    : null;

  if (existingById) {
    const merged = mergeUserProfiles(existingById, normalized);
    await updateProfile(db, existingById.id, merged);
    return { action: "updated", id: existingById.id };
  }

  if (existingByDedupeKey) {
    const merged = mergeUserProfiles(existingByDedupeKey, normalized);
    await updateProfile(db, existingByDedupeKey.id, merged);
    return { action: "merged", id: existingByDedupeKey.id };
  }

  const created = await createProfile(db, normalized);
  return { action: "created", id: created.id };
}

module.exports = (db, orderDb = null) => {
  ensureUserProfilesTable(db).catch((error) => {
    console.error("ensure user_profiles table failed:", error.message);
  });

  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM user_profiles ORDER BY id DESC");
      res.json({ userProfiles: rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const profile = await fetchProfileOrNull(db, req.params.id);
      if (!profile) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      res.json({ userProfile: profile });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const created = await createProfile(db, req.body);
      res.json({ id: created.id, message: "User profile created" });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      await updateProfile(db, req.params.id, req.body);
      res.json({ message: "User profile updated" });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      if (orderDb) {
        const [references] = await orderDb.execute(
          "SELECT COUNT(*) AS total FROM orders WHERE customer_id = ? OR sender_id = ?",
          [req.params.id, req.params.id]
        );
        if ((references[0]?.total || 0) > 0) {
          res.status(400).json({ error: "User profile is referenced by existing orders and cannot be deleted" });
          return;
        }
      }

      const [result] = await db.execute("DELETE FROM user_profiles WHERE id = ?", [req.params.id]);
      if (!result.affectedRows) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      res.json({ message: "User profile deleted" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/parse-excel", upload.single("excelFile"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);

      if (!jsonData.length) {
        res.status(400).json({ error: "Excel file is empty" });
        return;
      }

      const profile = normalizeUserProfileExcelRow(jsonData[0]);
      if (profile.id && !validateUserProfileId(profile.id)) {
        res.status(400).json({ error: "User ID must be country code + numeric sequence, for example ch001" });
        return;
      }

      res.json({ success: true, message: "Excel row parsed", data: profile });
    } catch (error) {
      res.status(500).json({ error: "Failed to parse Excel file: " + error.message });
    }
  });

  router.post("/import-excel", upload.single("excelFile"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);

      if (!jsonData.length) {
        res.status(400).json({ error: "Excel file is empty" });
        return;
      }

      const results = {
        total: jsonData.length,
        success: 0,
        failed: 0,
        merged: 0,
        updated: 0,
        errors: [],
      };

      for (let index = 0; index < jsonData.length; index += 1) {
        const rowNumber = index + 2;
        try {
          const profile = normalizeUserProfileExcelRow(jsonData[index]);
          if (profile.id && !validateUserProfileId(profile.id)) {
            throw new Error("User ID must be country code + numeric sequence, for example ch001");
          }

          const importResult = await importProfile(db, profile);
          if (importResult.action === "merged") {
            results.merged += 1;
          } else if (importResult.action === "updated") {
            results.updated += 1;
          } else {
            results.success += 1;
          }
        } catch (error) {
          results.failed += 1;
          results.errors.push({ row: rowNumber, errors: [error.message] });
        }
      }

      res.json({
        success: results.failed === 0,
        message: `Import complete: total ${results.total}, created ${results.success}, updated ${results.updated}, merged ${results.merged}, failed ${results.failed}`,
        results,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to import Excel file: " + error.message });
    }
  });

  return router;
};
