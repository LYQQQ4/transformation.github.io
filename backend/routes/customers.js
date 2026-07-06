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

function normalizeCustomerRow(raw) {
  const customer_id = String(raw["客户ID"] ?? raw["customer_id"] ?? "").trim();
  const delivery_address = String(raw["收货地址"] ?? raw["delivery_address"] ?? "").trim();
  const receiver_name = String(raw["收件人"] ?? raw["receiver_name"] ?? "").trim();
  const receiver_phone = String(raw["收件人电话"] ?? raw["receiver_phone"] ?? "").trim();
  return { customer_id, delivery_address, receiver_name, receiver_phone };
}

module.exports = (db) => {
  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM customer_info ORDER BY customer_id DESC");
      res.json({ customers: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM customer_info WHERE customer_id = ?", [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: "客户不存在" });
      }
      res.json({ customer: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const { customer_id, delivery_address, receiver_name, receiver_phone } = req.body;
      if (!customer_id || !String(customer_id).trim()) {
        return res.status(400).json({ error: "客户ID不能为空" });
      }
      await db.execute(
        "INSERT INTO customer_info (customer_id, delivery_address, receiver_name, receiver_phone) VALUES (?, ?, ?, ?)",
        [String(customer_id).trim(), delivery_address || null, receiver_name || null, receiver_phone || null]
      );
      res.json({ customer_id: String(customer_id).trim(), message: "客户创建成功" });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ error: "客户ID已存在" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const { delivery_address, receiver_name, receiver_phone } = req.body;
      const [result] = await db.execute(
        "UPDATE customer_info SET delivery_address = ?, receiver_name = ?, receiver_phone = ? WHERE customer_id = ?",
        [delivery_address || null, receiver_name || null, receiver_phone || null, req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "客户不存在" });
      }
      res.json({ message: "客户更新成功" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const [result] = await db.execute("DELETE FROM customer_info WHERE customer_id = ?", [req.params.id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "客户不存在" });
      }
      res.json({ message: "客户删除成功" });
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

      const customerData = normalizeCustomerRow(jsonData[0]);
      if (!customerData.customer_id) {
        return res.status(400).json({ error: "客户ID不能为空" });
      }

      res.json({ success: true, message: "Excel数据解析成功", data: customerData });
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
        const customerData = normalizeCustomerRow(jsonData[i]);

        if (!customerData.customer_id) {
          results.failed++;
          results.errors.push({ row: rowNumber, errors: ["客户ID不能为空"] });
          continue;
        }

        try {
          await db.execute(
            "INSERT INTO customer_info (customer_id, delivery_address, receiver_name, receiver_phone) VALUES (?, ?, ?, ?)",
            [customerData.customer_id, customerData.delivery_address || null, customerData.receiver_name || null, customerData.receiver_phone || null]
          );
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({ row: rowNumber, errors: [error.code === "ER_DUP_ENTRY" ? "客户ID已存在" : error.message] });
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
