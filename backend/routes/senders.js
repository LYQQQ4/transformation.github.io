const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("只允许上传Excel文件（.xls或.xlsx格式）"));
    }
  }
});

function normalizeSenderRow(raw) {
  const sender_id = String(raw["发件人ID"] ?? raw["sender_id"] ?? "").trim();
  const shipping_address = String(raw["发货地址"] ?? raw["shipping_address"] ?? "").trim();
  const sender_name = String(raw["发件人"] ?? raw["sender_name"] ?? "").trim();
  const sender_phone = String(raw["发件人电话"] ?? raw["sender_phone"] ?? "").trim();
  return { sender_id, shipping_address, sender_name, sender_phone };
}

module.exports = (db) => {
  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM sender_info ORDER BY sender_id DESC");
      res.json({ senders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM sender_info WHERE sender_id = ?", [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: "发件人不存在" });
      }
      res.json({ sender: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const { sender_id, shipping_address, sender_name, sender_phone } = req.body;
      if (!sender_id || !String(sender_id).trim()) {
        return res.status(400).json({ error: "发件人ID不能为空" });
      }
      await db.execute(
        "INSERT INTO sender_info (sender_id, shipping_address, sender_name, sender_phone) VALUES (?, ?, ?, ?)",
        [String(sender_id).trim(), shipping_address || null, sender_name || null, sender_phone || null]
      );
      res.json({ sender_id: String(sender_id).trim(), message: "发件人创建成功" });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ error: "发件人ID已存在" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const { shipping_address, sender_name, sender_phone } = req.body;
      const [result] = await db.execute(
        "UPDATE sender_info SET shipping_address = ?, sender_name = ?, sender_phone = ? WHERE sender_id = ?",
        [shipping_address || null, sender_name || null, sender_phone || null, req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "发件人不存在" });
      }
      res.json({ message: "发件人更新成功" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const [result] = await db.execute("DELETE FROM sender_info WHERE sender_id = ?", [req.params.id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "发件人不存在" });
      }
      res.json({ message: "发件人删除成功" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/parse-excel", upload.single("excelFile"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "没有上传文件" });
      }
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (!jsonData.length) {
        return res.status(400).json({ error: "Excel文件为空或没有有效数据" });
      }

      const senderData = normalizeSenderRow(jsonData[0]);
      if (!senderData.sender_id) {
        return res.status(400).json({ error: "发件人ID不能为空" });
      }

      res.json({ success: true, message: "Excel数据解析成功", data: senderData });
    } catch (error) {
      res.status(500).json({ error: "Excel文件解析失败: " + error.message });
    }
  });

  router.post("/import-excel", upload.single("excelFile"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "没有上传文件" });
      }
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (!jsonData.length) {
        return res.status(400).json({ error: "Excel文件为空或没有有效数据" });
      }

      const results = { total: jsonData.length, success: 0, failed: 0, errors: [] };

      for (let i = 0; i < jsonData.length; i++) {
        const rowNumber = i + 2;
        const senderData = normalizeSenderRow(jsonData[i]);

        if (!senderData.sender_id) {
          results.failed++;
          results.errors.push({ row: rowNumber, errors: ["发件人ID不能为空"] });
          continue;
        }

        try {
          await db.execute(
            "INSERT INTO sender_info (sender_id, shipping_address, sender_name, sender_phone) VALUES (?, ?, ?, ?)",
            [senderData.sender_id, senderData.shipping_address || null, senderData.sender_name || null, senderData.sender_phone || null]
          );
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({ row: rowNumber, errors: [error.code === "ER_DUP_ENTRY" ? "发件人ID已存在" : error.message] });
        }
      }

      res.json({
        success: results.failed === 0,
        message: `导入完成！总共${results.total}行数据，成功${results.success}行，失败${results.failed}行`,
        results
      });
    } catch (error) {
      res.status(500).json({ error: "Excel文件导入失败: " + error.message });
    }
  });

  return router;
};
