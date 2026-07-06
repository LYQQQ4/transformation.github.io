const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");

// 配置multer用于文件上传
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB限制
    },
    fileFilter: (req, file, cb) => {
        // 只允许Excel文件
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

module.exports = (db) => {
  // GET all packages
  router.get("/", async (req, res) => {
    try {
      // 首先检查package表是否存在
      const [tableCheck] = await db.execute("SHOW TABLES LIKE 'package'");
      if (tableCheck.length === 0) {
        return res.status(500).json({ error: "Package table does not exist" });
      }

      // 查询最新的20条包装信息，按创建时间倒序排列，并关联orders表以显示公司/指令人/业务类型/客户ID
      const [rows] = await db.execute(`
        SELECT p.*, o.company_name, o.orderer, o.business_type, o.customer_id
        FROM \`package\` p
        LEFT JOIN orders o ON p.serial_number = o.serial_number
        ORDER BY p.created_at DESC
        LIMIT 20
      `);
      res.json({ packages: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single package by id
  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute(`
        SELECT p.*, o.company_name, o.orderer, o.business_type, o.customer_id
        FROM \`package\` p
        LEFT JOIN orders o ON p.serial_number = o.serial_number
        WHERE p.id = ?
      `, [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: "Package not found" });
        return;
      }
      res.json({ package: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET package by serial_number
  router.get("/serial/:serial_number", async (req, res) => {
    try {
      const [rows] = await db.execute(`
        SELECT p.*, o.company_name, o.orderer, o.business_type, o.customer_id
        FROM \`package\` p
        LEFT JOIN orders o ON p.serial_number = o.serial_number
        WHERE p.serial_number = ?
      `, [req.params.serial_number]);
      if (rows.length === 0) {
        res.status(404).json({ error: "Package not found" });
        return;
      }
      res.json({ package: rows[0] });
    } catch (err) {
      try {
        const [rows] = await db.execute("SELECT * FROM \`package\` WHERE serial_number = ?", [req.params.serial_number]);
        if (rows.length === 0) {
          res.status(404).json({ error: "Package not found" });
          return;
        }
        res.json({ package: rows[0] });
      } catch (innerErr) {
        res.status(500).json({ error: innerErr.message });
      }
    }
  });

  // PUT update package
  router.put("/:id", async (req, res) => {
    try {
      const {
        product_name,
        product_code,
        pieces,
        length,
        width,
        height,
        volume,
        charge_weight,
        package_type,
        customs_port,
        customs_title,
        regulatory_conditions,
        remark1,
        remark2
      } = req.body;
      // 将undefined/null/空字符串转换为null，避免MySQL数值字段因""报错
      const toNull = (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v === "string" && v.trim() === "") return null;
        return v;
      };
      const sql = "UPDATE \`package\` SET product_name = ?, product_code = ?, pieces = ?, length = ?, width = ?, height = ?, volume = ?, charge_weight = ?, package_type = ?, customs_port = ?, customs_title = ?, regulatory_conditions = ?, remark1 = ?, remark2 = ? WHERE id = ?";
      const [result] = await db.execute(sql, [toNull(product_name), toNull(product_code), toNull(pieces), toNull(length), toNull(width), toNull(height), toNull(volume), toNull(charge_weight), toNull(package_type), toNull(customs_port), toNull(customs_title), toNull(regulatory_conditions), toNull(remark1), toNull(remark2), req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "Package not found" });
        return;
      }
      res.json({ message: "Package updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update package by serial_number
  router.put("/serial/:serial_number", async (req, res) => {
    try {
      const serialNumber = req.params.serial_number;
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const {
        product_name,
        product_code,
        pieces,
        length,
        width,
        height,
        volume,
        charge_weight,
        package_type,
        customs_port,
        customs_title,
        regulatory_conditions,
        remark1,
        remark2
      } = req.body;
      // 将undefined/null/空字符串转换为null，避免MySQL数值字段因""报错
      const toNull = (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v === "string" && v.trim() === "") return null;
        return v;
      };
      const sql = "UPDATE \`package\` SET product_name = ?, product_code = ?, pieces = ?, length = ?, width = ?, height = ?, volume = ?, charge_weight = ?, package_type = ?, customs_port = ?, customs_title = ?, regulatory_conditions = ?, remark1 = ?, remark2 = ? WHERE serial_number = ?";
      const [result] = await db.execute(sql, [toNull(product_name), toNull(product_code), toNull(pieces), toNull(length), toNull(width), toNull(height), toNull(volume), toNull(charge_weight), toNull(package_type), toNull(customs_port), toNull(customs_title), toNull(regulatory_conditions), toNull(remark1), toNull(remark2), serialNumber]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "Package not found" });
        return;
      }
      res.json({ message: "Package updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST parse Excel file (单行预览)
  router.post("/parse-excel", upload.single("excelFile"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "没有上传文件" });
      }

      // 解析Excel文件
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        return res.status(400).json({ error: "Excel文件为空或没有有效数据" });
      }

      // 只取第一行数据进行验证
      const excelData = jsonData[0];
      const validationResult = validatePackageExcelData(excelData);

      if (!validationResult.isValid) {
        return res.status(400).json({
          error: "数据验证失败",
          details: validationResult.errors
        });
      }

      res.json({
        success: true,
        message: "Excel数据解析成功",
        data: validationResult.data
      });

    } catch (error) {
      console.error("Excel解析错误:", error);
      res.status(500).json({ error: "Excel文件解析失败: " + error.message });
    }
  });

  // POST import Excel file (批量导入多行)
  router.post("/import-excel", upload.single("excelFile"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "没有上传文件" });
      }

      // 解析Excel文件
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        return res.status(400).json({ error: "Excel文件为空或没有有效数据" });
      }

      const results = {
        total: jsonData.length,
        success: 0,
        failed: 0,
        errors: [],
        successfulImports: []
      };

      // 处理每一行数据
      for (let i = 0; i < jsonData.length; i++) {
        const rowData = jsonData[i];
        const rowNumber = i + 2; // Excel行号从1开始，第一行是标题，所以数据行从第2行开始

        try {
          // 验证数据
          const validationResult = validatePackageExcelData(rowData);

          if (!validationResult.isValid) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: validationResult.errors
            });
            continue;
          }

          // 更新数据库
          const {
            serial_number,
            product_name,
            product_code,
            pieces,
            length,
            width,
            height,
            volume,
            charge_weight,
            package_type,
            customs_port,
            customs_title,
            regulatory_conditions,
            remark1,
            remark2
          } = validationResult.data;

          const toNull = (v) => {
            if (v === undefined || v === null) return null;
            if (typeof v === "string" && v.trim() === "") return null;
            return v;
          };

          const sql = "UPDATE \`package\` SET product_name = ?, product_code = ?, pieces = ?, length = ?, width = ?, height = ?, volume = ?, charge_weight = ?, package_type = ?, customs_port = ?, customs_title = ?, regulatory_conditions = ?, remark1 = ?, remark2 = ? WHERE serial_number = ?";
          const [updateResult] = await db.execute(sql, [
            toNull(product_name),
            toNull(product_code),
            toNull(pieces),
            toNull(length),
            toNull(width),
            toNull(height),
            toNull(volume),
            toNull(charge_weight),
            toNull(package_type),
            toNull(customs_port),
            toNull(customs_title),
            toNull(regulatory_conditions),
            toNull(remark1),
            toNull(remark2),
            toNull(serial_number)
          ]);

          if (updateResult.affectedRows > 0) {
            results.success++;
            results.successfulImports.push({
              serial_number: serial_number,
              row: rowNumber
            });
          } else {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: [`流水号 ${serial_number} 不存在于包装信息表中`]
            });
          }

        } catch (error) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            errors: [`数据库更新失败: ${error.message}`]
          });
        }
      }

      // 返回导入结果
      const message = `导入完成！总共${results.total}行数据，成功${results.success}行，失败${results.failed}行`;

      res.json({
        success: results.failed === 0,
        message: message,
        results: results
      });

    } catch (error) {
      console.error("Excel导入错误:", error);
      res.status(500).json({ error: "Excel文件导入失败: " + error.message });
    }
  });

  return router;
};

// Excel数据验证函数（包装信息专用）
function validatePackageExcelData(data) {
  const result = {
    isValid: true,
    errors: [],
    data: {}
  };

  // 定义字段映射
  const fieldMapping = {
    "流水号": "serial_number",
    "品名": "product_name",
    "商品编号": "product_code",
    "件数": "pieces",
    "长": "length",
    "宽": "width",
    "高": "height",
    "体积": "volume",
    "计费重量": "charge_weight",
    "包装种类": "package_type",
    "报关口岸": "customs_port",
    "报关抬头": "customs_title",
    "监管条件": "regulatory_conditions",
    "备注1": "remark1",
    "备注2": "remark2"
  };

  // 检查必需字段
  const requiredFields = ["serial_number"];

  // 将Excel字段名转换为数据库字段名
  for (const [excelField, dbField] of Object.entries(fieldMapping)) {
    if (data[excelField] !== undefined && data[excelField] !== null && data[excelField] !== "") {
      result.data[dbField] = data[excelField];
    }
  }

  // 检查必需字段是否为空
  for (const field of requiredFields) {
    if (!result.data[field] || result.data[field].toString().trim() === "") {
      // 查找所有可能的Excel字段名
      const excelFieldNames = Object.keys(fieldMapping).filter(key => fieldMapping[key] === field);
      const excelFieldName = excelFieldNames.length > 0 ? excelFieldNames[0] : field;
      result.errors.push(`"${excelFieldName}" 字段为空，请检查Excel文件`);
      result.isValid = false;
    }
  }

  // 验证数值字段
  const numericFields = ["pieces", "length", "width", "height", "volume", "charge_weight"];
  for (const field of numericFields) {
    if (result.data[field] !== undefined) {
      const value = parseFloat(result.data[field]);
      if (isNaN(value)) {
        const excelFieldName = Object.keys(fieldMapping).find(key => fieldMapping[key] === field);
        result.errors.push(`"${excelFieldName}" 必须是有效的数字`);
        result.isValid = false;
      } else {
        result.data[field] = value;
      }
    }
  }

  if (result.data.volume === undefined &&
      result.data.length !== undefined &&
      result.data.width !== undefined &&
      result.data.height !== undefined) {
    const pieces = result.data.pieces !== undefined ? result.data.pieces : 1;
    result.data.volume = result.data.length * result.data.width * result.data.height * pieces;
  }

  return result;
}
