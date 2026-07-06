const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");

// Configure multer for file uploads
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    // Check if file is Excel
    if (file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        file.mimetype === "application/vnd.ms-excel") {
      cb(null, true);
    } else {
      cb(new Error("只允许上传Excel文件"), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

module.exports = (db) => {
  // GET all guests
  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM guests ORDER BY guest_id DESC");
      res.json({ guests: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single guest by id
  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM guests WHERE guest_id = ?", [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: "客户不存在" });
        return;
      }
      res.json({ guest: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create new guest
  router.post("/", async (req, res) => {
    try {
      const {
        guest_id, region, company_cn, company_en, address_cn, address_en,
        postcode, contact_name, phone, email, tax_no, customs_10digit, remark
      } = req.body;

      // Validate required fields
      if (!contact_name || contact_name.trim() === '') {
        return res.status(400).json({ error: "联系人姓名不能为空" });
      }

      // If no guest_id provided, generate one compatible with existing varchar(50) PK
      const genGuestId = (guest_id && String(guest_id).trim()) ? String(guest_id).trim() : ('G' + Date.now());

      const sql = `INSERT INTO guests
        (guest_id, region, company_cn, company_en, address_cn, address_en, postcode,
         contact_name, phone, email, tax_no, customs_10digit, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await db.execute(sql, [
        genGuestId, region || '', company_cn || '', company_en || '', address_cn || '', address_en || '',
        postcode || '', contact_name.trim(), phone || '', email || '',
        tax_no || '', customs_10digit || '', remark || ''
      ]);
      res.json({ guest_id: genGuestId, message: "客户创建成功" });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        res.status(400).json({ error: "客户ID已存在" });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // PUT update guest
  router.put("/:id", async (req, res) => {
    try {
      const {
        region, company_cn, company_en, address_cn, address_en,
        postcode, contact_name, phone, email, tax_no, customs_10digit, remark
      } = req.body;
      const sql = `UPDATE guests SET
        region = ?, company_cn = ?, company_en = ?, address_cn = ?, address_en = ?,
        postcode = ?, contact_name = ?, phone = ?, email = ?, tax_no = ?,
        customs_10digit = ?, remark = ? WHERE guest_id = ?`;
      const [result] = await db.execute(sql, [
        region || '', company_cn || '', company_en || '', address_cn || '', address_en || '',
        postcode || '', contact_name || '', phone || '', email || '',
        tax_no || '', customs_10digit || '', remark || '', req.params.id
      ]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "客户不存在" });
        return;
      }
      res.json({ message: "客户信息更新成功" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE guest
  router.delete("/:id", async (req, res) => {
    try {
      const [result] = await db.execute("DELETE FROM guests WHERE guest_id = ?", [req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "客户不存在" });
        return;
      }
      res.json({ message: "客户删除成功" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST parse Excel file (preview)
  router.post("/parse-excel", upload.single("excelFile"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "未上传文件" });
      }

      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      // Remove header row and get first data row
      const headers = jsonData[0];
      const firstRow = jsonData[1];

      if (!firstRow || firstRow.length === 0) {
        return res.status(400).json({ error: "Excel文件为空或格式不正确" });
      }

      // Map Excel columns to database fields (matching actual table structure)
      const fieldMapping = {
        '客户ID': 'guest_id',
        '地区': 'region',
        '中文公司名称': 'company_cn',
        '英文公司名称': 'company_en',
        '中文地址': 'address_cn',
        '英文地址': 'address_en',
        '邮编': 'postcode',
        '姓名': 'contact_name',
        '电话': 'phone',
        '邮箱': 'email',
        '税号/欧盟号': 'tax_no',
        '海关10位数': 'customs_10digit',
        '备注': 'remark'
      };

      const mappedData = {};
      try {
        headers.forEach((header, index) => {
          const dbField = fieldMapping[header] || header;
          let value = firstRow[index];

          // Clean up the value for preview - ensure it's safe for JSON
          if (value !== null && value !== undefined && value !== '') {
            // Convert to string and clean up
            value = String(value).trim();

            // Remove control characters and problematic Unicode
            value = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

            // Remove mailto: prefix from emails
            if (dbField === 'email' && value.includes('mailto:')) {
              value = value.replace(/\(mailto:[^\)]+\)/g, '').trim();
            }

            // Handle multi-line addresses
            if (dbField === 'address_cn' || dbField === 'address_en') {
              value = value.replace(/\n/g, ', ').replace(/\r/g, '').trim();
            }
          } else {
            value = '';
          }

          // Ensure the value is safe for JSON
          if (typeof value === 'string') {
            mappedData[dbField] = value;
          } else {
            mappedData[dbField] = String(value || '');
          }
        });

        console.log('Mapped data for preview:', JSON.stringify(mappedData, null, 2));

      } catch (mappingError) {
        console.error('Error in data mapping:', mappingError);
        return res.status(500).json({
          error: "数据映射失败: " + mappingError.message,
          success: false
        });
      }

      // Clean up uploaded file
      const fs = require("fs");
      try {
        fs.unlinkSync(req.file.path);
      } catch (fileError) {
        console.warn('Error cleaning up file:', fileError);
      }

      // Ensure response is valid JSON
      const responseData = {
        success: true,
        data: mappedData,
        message: "Excel文件解析成功"
      };

      console.log('Sending response:', JSON.stringify(responseData, null, 2));
      res.json(responseData);

    } catch (error) {
      // Clean up uploaded file if it exists
      if (req.file && req.file.path) {
        const fs = require("fs");
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {}
      }
      res.status(500).json({ error: "Excel文件解析失败: " + error.message });
    }
  });

  // POST import Excel file (batch import)
  router.post("/import-excel", upload.single("excelFile"), async (req, res) => {
    console.log('Import Excel route called');
    console.log('Request file:', req.file);
    try {
      if (!req.file) {
        console.log('No file uploaded');
        return res.status(400).json({ error: "未上传文件" });
      }

      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (!jsonData || jsonData.length === 0) {
        return res.status(400).json({ error: "Excel文件为空或格式不正确" });
      }

      // Map Excel columns to database fields (matching actual table structure)
      const fieldMapping = {
        '客户ID': 'guest_id',
        '地区': 'region',
        '中文公司名称': 'company_cn',
        '英文公司名称': 'company_en',
        '中文地址': 'address_cn',
        '英文地址': 'address_en',
        '邮编': 'postcode',
        '姓名': 'contact_name',
        '电话': 'phone',
        '邮箱': 'email',
        '税号/欧盟号': 'tax_no',
        '海关10位数': 'customs_10digit',
        '备注': 'remark'
      };

      console.log('Starting batch import processing...');
      console.log('Total rows to process:', jsonData.length);
      console.log('Field mapping:', fieldMapping);

      const results = {
        total: jsonData.length,
        success: 0,
        failed: 0,
        errors: []
      };

      // Process each row
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        const rowNumber = i + 2; // Excel rows are 1-indexed, plus header row

        console.log(`Processing row ${rowNumber}:`, JSON.stringify(row, null, 2));

        try {
          // Map Excel data to database fields - ensure all fields are present
          const guestData = {};

          // Ensure guest_id is mapped from "客户ID"
          if (row['客户ID'] !== undefined) {
            guestData.guest_id = String(row['客户ID'] || '').trim();
          }

          // Map other fields
          Object.keys(fieldMapping).forEach(excelField => {
            if (excelField === '客户ID') return; // Already handled above

            const dbField = fieldMapping[excelField];
            if (!dbField) return;

            let value = row[excelField];

            console.log(`Mapping Excel field "${excelField}" to DB field "${dbField}": "${value}"`);

            // Clean up the value - handle various data types and special characters
            if (value !== null && value !== undefined && value !== '') {
              // Convert to string and clean up
              value = String(value).trim();

              // Remove control characters and problematic Unicode that can break JSON
              value = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

              // Remove mailto: prefix from emails
              if (dbField === 'email' && value.includes('mailto:')) {
                value = value.replace(/\(mailto:[^\)]+\)/g, '').trim();
              }

              // Handle multi-line addresses
              if (dbField === 'address_cn' || dbField === 'address_en') {
                value = value.replace(/\n/g, ', ').replace(/\r/g, '').trim();
              }
            } else {
              value = '';
            }

            guestData[dbField] = value;
          });

          // Validate required fields - guest_id and contact_name are required
          if (!guestData.guest_id || guestData.guest_id.trim() === '') {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: ['客户ID不能为空']
            });
            continue;
          }
          if (!guestData.contact_name || guestData.contact_name.trim() === '') {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: ['联系人姓名不能为空']
            });
            continue;
          }

          // Insert into database
          const sql = `INSERT INTO guests
            (guest_id, region, company_cn, company_en, address_cn, address_en, postcode,
             contact_name, phone, email, tax_no, customs_10digit, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          await db.execute(sql, [
            guestData.guest_id.trim(),
            guestData.region || '',
            guestData.company_cn || '',
            guestData.company_en || '',
            guestData.address_cn || '',
            guestData.address_en || '',
            guestData.postcode || '',
            guestData.contact_name.trim(),
            guestData.phone || '',
            guestData.email || '',
            guestData.tax_no || '',
            guestData.customs_10digit || '',
            guestData.remark || ''
          ]);

          results.success++;

        } catch (error) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            errors: [error.message]
          });
        }
      }

      // Clean up uploaded file
      const fs = require("fs");
      fs.unlinkSync(req.file.path);

      const message = `批量导入完成。成功导入 ${results.success} 条，失败 ${results.failed} 条。`;

      res.json({
        success: results.failed === 0,
        message: message,
        results: results
      });

    } catch (error) {
      // Clean up uploaded file if it exists
      if (req.file && req.file.path) {
        const fs = require("fs");
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {}
      }
      res.status(500).json({ error: "批量导入失败: " + error.message });
    }
  });

  return router;
};
