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
  // GET all transfers
  router.get("/", async (req, res) => {
    try {
      // 首先检查transfer表是否存在
      const [tableCheck] = await db.execute("SHOW TABLES LIKE 'transfer'");
      if (tableCheck.length === 0) {
        return res.status(500).json({ error: "Transfer table does not exist" });
      }

      const [rows] = await db.execute("SELECT * FROM transfer ORDER BY create_time DESC");
      res.json({ transfers: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET transfer by serial_number
  router.get("/serial/:serial_number", async (req, res) => {
    try {
      const serialNumber = req.params.serial_number;
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const [rows] = await db.execute("SELECT * FROM transfer WHERE serial_number = ?", [serialNumber]);
      if (rows.length === 0) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json({ transfer: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single transfer by id
  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM transfer WHERE id = ?", [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json({ transfer: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create new transfer (with auto-generated serial number)
  router.post("/", async (req, res) => {
    try {
      // Generate serial number if not provided
      let serialNumber = req.body.serial_number;
      if (!serialNumber) {
        serialNumber = await generateSerialNumber(db);
      }

      const {
        transport_mode,
        tracking_number,
        contract_number,
        pickup_date,
        arrival_port_time,
        clearance_time,
        delivery_time,
        complete_docs_send_time,
        cargo_flow_info,
        supplier,
        value_added_services,
        billing_period,
        remark1,
        remark2,
        remark3
      } = req.body;

      const sql = `INSERT INTO transfer (
        serial_number, transport_mode, tracking_number, contract_number,
        pickup_date, arrival_port_time, clearance_time, delivery_time,
        complete_docs_send_time, cargo_flow_info, supplier, value_added_services,
        billing_period, remark1, remark2, remark3
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      // 将 undefined 转为 null，以便正确绑定到 SQL（mysql2 不接受 undefined）
      const sanitize = (v) => (typeof v === 'undefined' ? null : v);
      const params = [
        sanitize(serialNumber), sanitize(transport_mode), sanitize(tracking_number), sanitize(contract_number),
        sanitize(pickup_date), sanitize(arrival_port_time), sanitize(clearance_time), sanitize(delivery_time),
        sanitize(complete_docs_send_time), sanitize(cargo_flow_info), sanitize(supplier), sanitize(value_added_services),
        sanitize(billing_period), sanitize(remark1), sanitize(remark2), sanitize(remark3)
      ];

      console.log('DEBUG insert transfer params:', params);
      const [result] = await db.execute(sql, params);

      res.json({
        message: "Transfer created successfully",
        id: result.insertId,
        serial_number: serialNumber
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update transfer by serial_number
  router.put("/serial/:serial_number", async (req, res) => {
    try {
      const {
        transport_mode,
        tracking_number,
        contract_number,
        pickup_date,
        arrival_port_time,
        clearance_time,
        delivery_time,
        complete_docs_send_time,
        cargo_flow_info,
        supplier,
        value_added_services,
        billing_period,
        remark1,
        remark2,
        remark3
      } = req.body;

      const sql = `UPDATE transfer SET
        transport_mode = ?, tracking_number = ?, contract_number = ?,
        pickup_date = ?, arrival_port_time = ?, clearance_time = ?, delivery_time = ?,
        complete_docs_send_time = ?, cargo_flow_info = ?, supplier = ?, value_added_services = ?,
        billing_period = ?, remark1 = ?, remark2 = ?, remark3 = ?
        WHERE serial_number = ?`;

      // 将 undefined 转为 null，以便正确绑定到 SQL（mysql2 不接受 undefined）
      const sanitize = (v) => (typeof v === 'undefined' ? null : v);
      const params = [
        sanitize(transport_mode), sanitize(tracking_number), sanitize(contract_number),
        sanitize(pickup_date), sanitize(arrival_port_time), sanitize(clearance_time), sanitize(delivery_time),
        sanitize(complete_docs_send_time), sanitize(cargo_flow_info), sanitize(supplier), sanitize(value_added_services),
        sanitize(billing_period), sanitize(remark1), sanitize(remark2), sanitize(remark3), sanitize(req.params.serial_number)
      ];

      const [result] = await db.execute(sql, params);

      if (result.affectedRows === 0) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json({ message: "Transfer updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update transfer
  router.put("/:id", async (req, res) => {
    try {
      const {
        serial_number,
        transport_mode,
        tracking_number,
        contract_number,
        pickup_date,
        arrival_port_time,
        clearance_time,
        delivery_time,
        complete_docs_send_time,
        cargo_flow_info,
        supplier,
        value_added_services,
        billing_period,
        remark1,
        remark2,
        remark3
      } = req.body;

      const sql = `UPDATE transfer SET
        serial_number = ?, transport_mode = ?, tracking_number = ?, contract_number = ?,
        pickup_date = ?, arrival_port_time = ?, clearance_time = ?, delivery_time = ?,
        complete_docs_send_time = ?, cargo_flow_info = ?, supplier = ?, value_added_services = ?,
        billing_period = ?, remark1 = ?, remark2 = ?, remark3 = ?
        WHERE id = ?`;

      // 将 undefined 转为 null，以便正确绑定到 SQL（mysql2 不接受 undefined）
      const sanitize = (v) => (typeof v === 'undefined' ? null : v);
      const params = [
        sanitize(serial_number), sanitize(transport_mode), sanitize(tracking_number), sanitize(contract_number),
        sanitize(pickup_date), sanitize(arrival_port_time), sanitize(clearance_time), sanitize(delivery_time),
        sanitize(complete_docs_send_time), sanitize(cargo_flow_info), sanitize(supplier), sanitize(value_added_services),
        sanitize(billing_period), sanitize(remark1), sanitize(remark2), sanitize(remark3), sanitize(req.params.id)
      ];

      const [result] = await db.execute(sql, params);

      if (result.affectedRows === 0) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json({ message: "Transfer updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE transfer
  router.delete("/:id", async (req, res) => {
    try {
      const [result] = await db.execute("DELETE FROM transfer WHERE id = ?", [req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json({ message: "Transfer deleted successfully" });
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
      const validationResult = validateTransferExcelData(excelData);

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
          const validationResult = validateTransferExcelData(rowData);

          if (!validationResult.isValid) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: validationResult.errors
            });
            continue;
          }

          // 检查是否需要生成流水号
          let serialNumber = validationResult.data.serial_number;
          if (!serialNumber) {
            serialNumber = await generateSerialNumber(db);
            validationResult.data.serial_number = serialNumber;
          }

          // 检查流水号是否存在
          const [existingTransfer] = await db.execute("SELECT id FROM transfer WHERE serial_number = ?", [serialNumber]);
          if (existingTransfer.length === 0) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: [`流水号 ${serialNumber} 不存在于物流信息表中`]
            });
            continue;
          }

          const {
            transport_mode,
            tracking_number,
            contract_number,
            pickup_date,
            arrival_port_time,
            clearance_time,
            delivery_time,
            complete_docs_send_time,
            cargo_flow_info,
            supplier,
            value_added_services,
            billing_period,
            remark1,
            remark2,
            remark3
          } = validationResult.data;

          // 更新数据库
          const sql = `UPDATE transfer SET
            transport_mode = ?, tracking_number = ?, contract_number = ?,
            pickup_date = ?, arrival_port_time = ?, clearance_time = ?, delivery_time = ?,
            complete_docs_send_time = ?, cargo_flow_info = ?, supplier = ?, value_added_services = ?,
            billing_period = ?, remark1 = ?, remark2 = ?, remark3 = ?
            WHERE serial_number = ?`;

          const [updateResult] = await db.execute(sql, [
            transport_mode || null, tracking_number, contract_number || null,
            pickup_date || null, arrival_port_time || null, clearance_time || null, delivery_time || null,
            complete_docs_send_time || null, cargo_flow_info || null, supplier || null, value_added_services || null,
            billing_period || null, remark1 || null, remark2 || null, remark3 || null,
            serialNumber
          ]);

          if (updateResult.affectedRows > 0) {
            results.success++;
            results.successfulImports.push({
              serial_number: serialNumber,
              row: rowNumber
            });
          } else {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: ["数据库更新失败"]
            });
          }

        } catch (error) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            errors: [`数据库操作失败: ${error.message}`]
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

// 生成流水号函数
async function generateSerialNumber(db) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const datePrefix = `${year}${month}${day}`;

  // 查询今天已有的最大流水号
  const [rows] = await db.execute(
    "SELECT serial_number FROM transfer WHERE serial_number LIKE ? ORDER BY serial_number DESC LIMIT 1",
    [`${datePrefix}%`]
  );

  let sequenceNumber = 1;
  if (rows.length > 0) {
    const lastSerial = rows[0].serial_number;
    const lastSequence = parseInt(lastSerial.substring(datePrefix.length)) || 0;
    sequenceNumber = lastSequence + 1;
  }

  return `${datePrefix}${String(sequenceNumber).padStart(4, "0")}`;
}

// Excel数据验证函数（物流信息专用）
function validateTransferExcelData(data) {
  const result = {
    isValid: true,
    errors: [],
    data: {}
  };

  // 定义字段映射
  const fieldMapping = {
    "流水号": "serial_number",
    "运输方式": "transport_mode",
    "运单号": "tracking_number",
    "合同协议号": "contract_number",
    "提货日期": "pickup_date",
    "到港时间": "arrival_port_time",
    "放行时间": "clearance_time",
    "送达时间": "delivery_time",
    "完整资料发送时间": "complete_docs_send_time",
    "货物流转信息": "cargo_flow_info",
    "供应商": "supplier",
    "增值服务备注": "value_added_services",
    "账单期": "billing_period",
    "备注1": "remark1",
    "备注2": "remark2",
    "备注3": "remark3"
  };

  // 检查必需字段
  const requiredFields = ["tracking_number"];

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

  // 验证日期字段
  const dateFields = ["pickup_date"];
  for (const field of dateFields) {
    if (result.data[field]) {
      const dateValue = new Date(result.data[field]);
      if (isNaN(dateValue.getTime())) {
        const excelFieldName = Object.keys(fieldMapping).find(key => fieldMapping[key] === field);
        result.errors.push(`"${excelFieldName}" 必须是有效的日期格式`);
        result.isValid = false;
      } else {
        // 格式化为YYYY-MM-DD
        result.data[field] = dateValue.toISOString().split("T")[0];
      }
    }
  }

  // 验证日期时间字段
  const datetimeFields = ["arrival_port_time", "clearance_time", "delivery_time", "complete_docs_send_time"];
  for (const field of datetimeFields) {
    if (result.data[field]) {
      const dateValue = new Date(result.data[field]);
      if (isNaN(dateValue.getTime())) {
        const excelFieldName = Object.keys(fieldMapping).find(key => fieldMapping[key] === field);
        result.errors.push(`"${excelFieldName}" 必须是有效的日期时间格式`);
        result.isValid = false;
      } else {
        // 格式化为YYYY-MM-DD HH:mm:ss
        result.data[field] = dateValue.toISOString().slice(0, 19).replace("T", " ");
      }
    }
  }

  return result;
}
