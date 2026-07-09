const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const {
  normalizeCountryCode,
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

function mapProfileToSender(profile) {
  return {
    sender_id: profile.id,
    shipping_address: profile.address,
    sender_name: profile.contact_name,
    sender_phone: profile.phone,
    address: profile.address,
    contact_name: profile.contact_name,
    phone: profile.phone,
    company_name: profile.company_name,
    email: profile.email,
    remark: profile.remark,
    legacy_sender_id: profile.legacy_sender_id,
  };
}

function mapSenderPayload(body = {}) {
  const payload = normalizeUserProfilePayload({
    id: body.sender_id,
    address: body.shipping_address ?? body.address,
    contact_name: body.sender_name ?? body.contact_name,
    phone: body.sender_phone ?? body.phone,
    company_name: body.company_name,
    email: body.email,
    remark: body.remark,
    source_type: "sender",
    legacy_sender_id: body.legacy_sender_id || body.sender_id,
  });

  if (payload.id) {
    payload.country_code = normalizeCountryCode(payload.id.slice(0, 2), payload.country_code);
    payload.sequence_no = parseInt(payload.id.slice(2), 10);
  }

  return payload;
}

function normalizeSenderExcelRow(row = {}) {
  return {
    sender_id: String(row["发件人ID"] ?? row.sender_id ?? row.id ?? "").trim(),
    shipping_address: String(row["地址"] ?? row["发货地址"] ?? row.shipping_address ?? row.address ?? "").trim(),
    sender_name: String(row["联系人姓名"] ?? row["发件人"] ?? row.sender_name ?? row.contact_name ?? "").trim(),
    sender_phone: String(row["电话"] ?? row["发件人电话"] ?? row.sender_phone ?? row.phone ?? "").trim(),
    company_name: String(row["公司名称"] ?? row.company_name ?? "").trim(),
    email: String(row["邮箱"] ?? row.email ?? "").trim(),
    remark: String(row["备注"] ?? row.remark ?? "").trim(),
  };
}

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
      KEY idx_user_profiles_legacy_sender_id (legacy_sender_id),
      KEY idx_user_profiles_legacy_customer_id (legacy_customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = (db, orderDb = null) => {
  ensureUserProfilesTable(db).catch(() => {});

  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute(
        "SELECT * FROM user_profiles WHERE source_type IN ('sender', 'both', 'mixed') OR legacy_sender_id IS NOT NULL ORDER BY id DESC"
      );
      res.json({ senders: rows.map(mapProfileToSender) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM user_profiles WHERE id = ?", [req.params.id]);
      if (!rows.length) {
        res.status(404).json({ error: "Sender not found" });
        return;
      }
      res.json({ sender: mapProfileToSender(rows[0]) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const payload = mapSenderPayload(req.body);
      if (!payload.id || !validateUserProfileId(payload.id)) {
        res.status(400).json({ error: "Sender ID must be country code + numeric sequence, for example ch001" });
        return;
      }

      await db.execute(
        `INSERT INTO user_profiles
          (id, country_code, sequence_no, company_name, address, contact_name, phone, email, remark, dedupe_key, source_type, legacy_sender_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.id,
          payload.country_code,
          payload.sequence_no,
          payload.company_name,
          payload.address,
          payload.contact_name,
          payload.phone,
          payload.email,
          payload.remark,
          payload.dedupe_key,
          payload.source_type,
          payload.legacy_sender_id,
        ]
      );

      res.json({ sender_id: payload.id, message: "Sender created" });
    } catch (error) {
      const isDuplicate = error.code === "ER_DUP_ENTRY";
      res.status(isDuplicate ? 400 : 500).json({
        error: isDuplicate ? "Sender ID already exists" : error.message,
      });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const payload = mapSenderPayload({ ...req.body, sender_id: req.params.id });
      const [result] = await db.execute(
        `UPDATE user_profiles
            SET company_name = ?, address = ?, contact_name = ?, phone = ?, email = ?, remark = ?, dedupe_key = ?, source_type = ?, legacy_sender_id = ?
          WHERE id = ?`,
        [
          payload.company_name,
          payload.address,
          payload.contact_name,
          payload.phone,
          payload.email,
          payload.remark,
          payload.dedupe_key,
          payload.source_type,
          payload.legacy_sender_id,
          req.params.id,
        ]
      );

      if (!result.affectedRows) {
        res.status(404).json({ error: "Sender not found" });
        return;
      }

      res.json({ message: "Sender updated" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      if (orderDb) {
        const [references] = await orderDb.execute(
          "SELECT COUNT(*) AS total FROM orders WHERE sender_id = ?",
          [req.params.id]
        );
        if ((references[0]?.total || 0) > 0) {
          res.status(400).json({ error: "Sender is referenced by existing orders and cannot be deleted" });
          return;
        }
      }

      const [result] = await db.execute("DELETE FROM user_profiles WHERE id = ?", [req.params.id]);
      if (!result.affectedRows) {
        res.status(404).json({ error: "Sender not found" });
        return;
      }

      res.json({ message: "Sender deleted" });
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

      res.json({ success: true, message: "Excel row parsed", data: normalizeSenderExcelRow(jsonData[0]) });
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

      const results = { total: jsonData.length, success: 0, failed: 0, errors: [] };
      for (let index = 0; index < jsonData.length; index += 1) {
        const rowNumber = index + 2;
        try {
          const payload = mapSenderPayload(normalizeSenderExcelRow(jsonData[index]));
          if (!payload.id || !validateUserProfileId(payload.id)) {
            throw new Error("Sender ID must be country code + numeric sequence, for example ch001");
          }

          await db.execute(
            `INSERT INTO user_profiles
              (id, country_code, sequence_no, company_name, address, contact_name, phone, email, remark, dedupe_key, source_type, legacy_sender_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                company_name = VALUES(company_name),
                address = VALUES(address),
                contact_name = VALUES(contact_name),
                phone = VALUES(phone),
                email = VALUES(email),
                remark = VALUES(remark),
                dedupe_key = VALUES(dedupe_key),
                source_type = VALUES(source_type),
                legacy_sender_id = VALUES(legacy_sender_id)`,
            [
              payload.id,
              payload.country_code,
              payload.sequence_no,
              payload.company_name,
              payload.address,
              payload.contact_name,
              payload.phone,
              payload.email,
              payload.remark,
              payload.dedupe_key,
              payload.source_type,
              payload.legacy_sender_id,
            ]
          );

          results.success += 1;
        } catch (error) {
          results.failed += 1;
          results.errors.push({ row: rowNumber, errors: [error.message] });
        }
      }

      res.json({
        success: results.failed === 0,
        message: `Import complete: total ${results.total}, success ${results.success}, failed ${results.failed}`,
        results,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to import Excel file: " + error.message });
    }
  });

  return router;
};
