const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const {
  buildTransferSharedSelect,
  normalizeTransferSharedPayload,
} = require("../lib/tracking_fields");
const { syncTrackingFieldsBySerial } = require("../lib/tracking_sync");

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

function normalizeTransferSerialNumber(value) {
  return String(value || "").trim();
}

function logTransferRouteError(routeName, context, error) {
  const payload = context ? ` ${JSON.stringify(context)}` : "";
  console.error(`[transfer] ${routeName}${payload}:`, error);
}

function normalizeOptionalTransferValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function buildLocalDateParts(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  const date = new Date(normalizedYear, normalizedMonth - 1, normalizedDay);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== normalizedYear ||
    date.getMonth() + 1 !== normalizedMonth ||
    date.getDate() !== normalizedDay
  ) {
    return null;
  }

  return {
    year: String(normalizedYear),
    month: padDatePart(normalizedMonth),
    day: padDatePart(normalizedDay),
  };
}

function parseExcelSerialDateParts(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const wholeDays = Math.floor(numericValue);
  const fraction = numericValue - wholeDays;
  const date = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
  const totalSeconds = Math.round(fraction * 86400);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    year: String(date.getUTCFullYear()),
    month: padDatePart(date.getUTCMonth() + 1),
    day: padDatePart(date.getUTCDate()),
    hour: padDatePart(hours % 24),
    minute: padDatePart(minutes),
    second: padDatePart(seconds),
  };
}

function normalizeOptionalDateField(value, fieldLabel, options = {}) {
  const { includeTime = false, allowExcelSerial = false } = options;
  const normalizedValue = normalizeOptionalTransferValue(value);

  if (normalizedValue === "") {
    return { value: null };
  }

  if (typeof normalizedValue === "number" && allowExcelSerial) {
    const dateParts = parseExcelSerialDateParts(normalizedValue);
    if (!dateParts) {
      return { error: `${fieldLabel}格式不正确，请填写有效日期` };
    }

    if (!includeTime) {
      return { value: `${dateParts.year}-${dateParts.month}-${dateParts.day}` };
    }

    return {
      value: `${dateParts.year}-${dateParts.month}-${dateParts.day} ${dateParts.hour}:${dateParts.minute}:${dateParts.second}`
    };
  }

  if (typeof normalizedValue !== "string") {
    return { error: `${fieldLabel}格式不正确，请使用 YYYY-MM-DD 或 YYYY/MM/DD` };
  }

  const trimmed = normalizedValue.trim();
  if (!trimmed) {
    return { value: null };
  }

  const ymdMatch = trimmed.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/
  );
  const mdyMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/
  );

  let parts = null;
  let timeParts = { hour: "0", minute: "0", second: "0" };

  if (ymdMatch) {
    const [, year, month, day, hour = "0", minute = "0", second = "0"] = ymdMatch;
    parts = buildLocalDateParts(year, month, day);
    timeParts = { hour, minute, second };
  } else if (mdyMatch) {
    const [, month, day, year, hour = "0", minute = "0", second = "0"] = mdyMatch;
    parts = buildLocalDateParts(year, month, day);
    timeParts = { hour, minute, second };
  }

  if (!parts) {
    return { error: `${fieldLabel}格式不正确，请使用 YYYY-MM-DD、YYYY/MM/DD 或 Excel 序列号` };
  }

  if (!includeTime) {
    return { value: `${parts.year}-${parts.month}-${parts.day}` };
  }

  const normalizedHour = Number(timeParts.hour);
  const normalizedMinute = Number(timeParts.minute);
  const normalizedSecond = Number(timeParts.second);
  if (
    normalizedHour < 0 || normalizedHour > 23 ||
    normalizedMinute < 0 || normalizedMinute > 59 ||
    normalizedSecond < 0 || normalizedSecond > 59
  ) {
    return { error: `${fieldLabel}时间格式不正确，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss` };
  }

  return {
    value: `${parts.year}-${parts.month}-${parts.day} ${padDatePart(normalizedHour)}:${padDatePart(normalizedMinute)}:${padDatePart(normalizedSecond)}`
  };
}

function sanitizeTransferValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
}

function normalizeTransferPayloadDates(payload = {}) {
  const pickupDateResult = normalizeOptionalDateField(payload.pickup_date, "提货日期");
  const arrivalPortTimeResult = normalizeOptionalDateField(payload.arrival_port_time, "到港时间", { includeTime: true });
  const clearanceTimeResult = normalizeOptionalDateField(payload.clearance_time, "放行时间", { includeTime: true });
  const deliveryTimeResult = normalizeOptionalDateField(payload.delivery_time, "送达时间", { includeTime: true });
  const completeDocsSendTimeResult = normalizeOptionalDateField(payload.complete_docs_send_time, "完整资料发送时间", { includeTime: true });

  return {
    errors: [
      pickupDateResult.error,
      arrivalPortTimeResult.error,
      clearanceTimeResult.error,
      deliveryTimeResult.error,
      completeDocsSendTimeResult.error,
    ].filter(Boolean),
    values: {
      pickup_date: pickupDateResult.value,
      arrival_port_time: arrivalPortTimeResult.value,
      clearance_time: clearanceTimeResult.value,
      delivery_time: deliveryTimeResult.value,
      complete_docs_send_time: completeDocsSendTimeResult.value,
    },
  };
}

const TRANSFER_SELECT_COLUMNS = `
          t.id,
          t.serial_number,
          t.transport_mode,
          ${buildTransferSharedSelect("t")},
          t.pickup_date,
          t.arrival_port_time,
          t.clearance_time,
          t.delivery_time,
          t.complete_docs_send_time,
          t.billing_period,
          t.remark3,
          t.create_time,
          t.update_time,
          o.company_name,
          o.orderer,
          o.business_type,
          o.sender_id,
          o.customer_id,
          o.receive_date,
          o.origin,
          o.destination,
          o.trade_term,
          o.product_name
`;

module.exports = (db) => {
  // GET all transfers
  router.get("/", async (req, res) => {
    try {
      // 首先检查transfer表是否存在
      const [tableCheck] = await db.execute("SHOW TABLES LIKE 'transfer'");
      if (tableCheck.length === 0) {
        return res.status(500).json({ error: "Transfer table does not exist" });
      }

      const [rows] = await db.execute(`
        SELECT
${TRANSFER_SELECT_COLUMNS}
        FROM transfer t
        LEFT JOIN orders o ON t.serial_number = o.serial_number
        ORDER BY t.create_time DESC
      `);
      res.json({ transfers: rows });
    } catch (err) {
      logTransferRouteError("list", null, err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET transfer by serial_number
  router.get("/serial/:serial_number", async (req, res) => {
    try {
      const serialNumber = normalizeTransferSerialNumber(req.params.serial_number);
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const [rows] = await db.execute(
        `SELECT
${TRANSFER_SELECT_COLUMNS}
         FROM transfer t
         LEFT JOIN orders o ON t.serial_number = o.serial_number
         WHERE t.serial_number = ?`,
        [serialNumber]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json({ transfer: rows[0] });
    } catch (err) {
      logTransferRouteError("getBySerial", { serial_number: req.params.serial_number }, err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET single transfer by id
  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT
${TRANSFER_SELECT_COLUMNS}
         FROM transfer t
         LEFT JOIN orders o ON t.serial_number = o.serial_number
         WHERE t.id = ?`,
        [req.params.id]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json({ transfer: rows[0] });
    } catch (err) {
      logTransferRouteError("getById", { id: req.params.id }, err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST create new transfer (with auto-generated serial number)
  router.post("/", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      // Generate serial number if not provided
      let serialNumber = req.body.serial_number;
      if (!serialNumber) {
        serialNumber = await generateSerialNumber(db);
      }

      const {
        transport_mode,
        pickup_date,
        arrival_port_time,
        clearance_time,
        delivery_time,
        complete_docs_send_time,
        billing_period,
        remark3
      } = req.body;
      const sharedFields = normalizeTransferSharedPayload(req.body);

      const normalizedDates = normalizeTransferPayloadDates(req.body);
      if (normalizedDates.errors.length > 0) {
        return res.status(400).json({ error: normalizedDates.errors.join("; ") });
      }

      if (!sharedFields.tracking_number) {
        return res.status(400).json({ error: "运单号不能为空" });
      }

      const sql = `INSERT INTO transfer (
        serial_number, transport_mode, tracking_number, contract_number,
        pickup_date, arrival_port_time, clearance_time, delivery_time,
        complete_docs_send_time, cargo_flow_info, supplier, value_added_services,
        billing_period, remark1, remark2, remark3
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      // 将 undefined 转为 null，以便正确绑定到 SQL（mysql2 不接受 undefined）
      const sanitize = (v) => (typeof v === 'undefined' ? null : v);
      const params = [
        sanitizeTransferValue(serialNumber), sanitizeTransferValue(transport_mode), sharedFields.tracking_number, sharedFields.contract_number,
        normalizedDates.values.pickup_date, normalizedDates.values.arrival_port_time, normalizedDates.values.clearance_time, normalizedDates.values.delivery_time,
        normalizedDates.values.complete_docs_send_time, sharedFields.cargo_flow_info, sharedFields.transport_supplier, sharedFields.value_added_services,
        sanitizeTransferValue(billing_period), sharedFields.remark1, sharedFields.remark2, sanitizeTransferValue(remark3)
      ];

      await connection.beginTransaction();
      transactionStarted = true;

      const [result] = await connection.execute(sql, params);

      await syncTrackingFieldsBySerial(connection, serialNumber, {
        transport_mode: sanitizeTransferValue(transport_mode),
        transport_supplier: sharedFields.transport_supplier,
        cargo_flow_info: sharedFields.cargo_flow_info,
        remark1: sharedFields.remark1,
        remark2: sharedFields.remark2,
        excludeTables: ["transfer"],
      });

      await connection.commit();

      res.json({
        message: "Transfer created successfully",
        id: result.insertId,
        serial_number: serialNumber
      });
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  // PUT update transfer by serial_number
  router.put("/serial/:serial_number", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      const serialNumber = normalizeTransferSerialNumber(req.params.serial_number);
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const {
        transport_mode,
        pickup_date,
        arrival_port_time,
        clearance_time,
        delivery_time,
        complete_docs_send_time,
        billing_period,
        remark3
      } = req.body;
      const sharedFields = normalizeTransferSharedPayload(req.body);

      const normalizedDates = normalizeTransferPayloadDates(req.body);
      if (normalizedDates.errors.length > 0) {
        return res.status(400).json({ error: normalizedDates.errors.join("; ") });
      }

      if (!sharedFields.tracking_number) {
        return res.status(400).json({ error: "运单号不能为空" });
      }

      const sql = `UPDATE transfer SET
        transport_mode = ?, tracking_number = ?, contract_number = ?,
        pickup_date = ?, arrival_port_time = ?, clearance_time = ?, delivery_time = ?,
        complete_docs_send_time = ?, cargo_flow_info = ?, supplier = ?, value_added_services = ?,
        billing_period = ?, remark1 = ?, remark2 = ?, remark3 = ?
        WHERE serial_number = ?`;

      // 将 undefined 转为 null，以便正确绑定到 SQL（mysql2 不接受 undefined）
      const sanitize = (v) => (typeof v === 'undefined' ? null : v);
      const params = [
        sanitizeTransferValue(transport_mode), sharedFields.tracking_number, sharedFields.contract_number,
        normalizedDates.values.pickup_date, normalizedDates.values.arrival_port_time, normalizedDates.values.clearance_time, normalizedDates.values.delivery_time,
        normalizedDates.values.complete_docs_send_time, sharedFields.cargo_flow_info, sharedFields.transport_supplier, sharedFields.value_added_services,
        sanitizeTransferValue(billing_period), sharedFields.remark1, sharedFields.remark2, sanitizeTransferValue(remark3), sanitizeTransferValue(serialNumber)
      ];

      await connection.beginTransaction();
      transactionStarted = true;

      const [result] = await connection.execute(sql, params);

      if (result.affectedRows === 0) {
        await connection.rollback();
        res.status(404).json({ error: "Transfer not found" });
        return;
      }

      await syncTrackingFieldsBySerial(connection, serialNumber, {
        transport_mode: sanitizeTransferValue(transport_mode),
        transport_supplier: sharedFields.transport_supplier,
        cargo_flow_info: sharedFields.cargo_flow_info,
        remark1: sharedFields.remark1,
        remark2: sharedFields.remark2,
        excludeTables: ["transfer"],
      });

      await connection.commit();
      res.json({ message: "Transfer updated successfully" });
    } catch (err) {
      logTransferRouteError("updateBySerial", { serial_number: req.params.serial_number, body: req.body }, err);
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  // PUT update transfer
  router.put("/:id", async (req, res) => {
    const connection = await db.getConnection();
    let transactionStarted = false;
    try {
      const {
        serial_number,
        transport_mode,
        pickup_date,
        arrival_port_time,
        clearance_time,
        delivery_time,
        complete_docs_send_time,
        billing_period,
        remark3
      } = req.body;
      const sharedFields = normalizeTransferSharedPayload(req.body);

      const normalizedDates = normalizeTransferPayloadDates(req.body);
      if (normalizedDates.errors.length > 0) {
        return res.status(400).json({ error: normalizedDates.errors.join("; ") });
      }

      if (!sharedFields.tracking_number) {
        return res.status(400).json({ error: "运单号不能为空" });
      }

      const sql = `UPDATE transfer SET
        serial_number = ?, transport_mode = ?, tracking_number = ?, contract_number = ?,
        pickup_date = ?, arrival_port_time = ?, clearance_time = ?, delivery_time = ?,
        complete_docs_send_time = ?, cargo_flow_info = ?, supplier = ?, value_added_services = ?,
        billing_period = ?, remark1 = ?, remark2 = ?, remark3 = ?
        WHERE id = ?`;

      // 将 undefined 转为 null，以便正确绑定到 SQL（mysql2 不接受 undefined）
      const sanitize = (v) => (typeof v === 'undefined' ? null : v);
      const params = [
        sanitizeTransferValue(serial_number), sanitizeTransferValue(transport_mode), sharedFields.tracking_number, sharedFields.contract_number,
        normalizedDates.values.pickup_date, normalizedDates.values.arrival_port_time, normalizedDates.values.clearance_time, normalizedDates.values.delivery_time,
        normalizedDates.values.complete_docs_send_time, sharedFields.cargo_flow_info, sharedFields.transport_supplier, sharedFields.value_added_services,
        sanitizeTransferValue(billing_period), sharedFields.remark1, sharedFields.remark2, sanitizeTransferValue(remark3), sanitizeTransferValue(req.params.id)
      ];

      await connection.beginTransaction();
      transactionStarted = true;

      const [result] = await connection.execute(sql, params);

      if (result.affectedRows === 0) {
        await connection.rollback();
        res.status(404).json({ error: "Transfer not found" });
        return;
      }

      await syncTrackingFieldsBySerial(connection, sanitizeTransferValue(serial_number), {
        transport_mode: sanitizeTransferValue(transport_mode),
        transport_supplier: sharedFields.transport_supplier,
        cargo_flow_info: sharedFields.cargo_flow_info,
        remark1: sharedFields.remark1,
        remark2: sharedFields.remark2,
        excludeTables: ["transfer"],
      });

      await connection.commit();
      res.json({ message: "Transfer updated successfully" });
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback();
      }
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
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
            pickup_date,
            arrival_port_time,
            clearance_time,
            delivery_time,
            complete_docs_send_time,
            billing_period,
            remark3
          } = validationResult.data;
          const sharedFields = normalizeTransferSharedPayload(validationResult.data);

          if (!sharedFields.tracking_number) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: ["运单号不能为空"]
            });
            continue;
          }

          // 更新数据库
          const sql = `UPDATE transfer SET
            transport_mode = ?, tracking_number = ?, contract_number = ?,
            pickup_date = ?, arrival_port_time = ?, clearance_time = ?, delivery_time = ?,
            complete_docs_send_time = ?, cargo_flow_info = ?, supplier = ?, value_added_services = ?,
            billing_period = ?, remark1 = ?, remark2 = ?, remark3 = ?
            WHERE serial_number = ?`;

          const rowConnection = await db.getConnection();
          let rowTransactionStarted = false;
          let updateResult;
          try {
            await rowConnection.beginTransaction();
            rowTransactionStarted = true;

            [updateResult] = await rowConnection.execute(sql, [
              sanitizeTransferValue(transport_mode), sharedFields.tracking_number, sharedFields.contract_number,
              pickup_date || null, arrival_port_time || null, clearance_time || null, delivery_time || null,
              complete_docs_send_time || null, sharedFields.cargo_flow_info, sharedFields.transport_supplier, sharedFields.value_added_services,
              sanitizeTransferValue(billing_period), sharedFields.remark1, sharedFields.remark2, sanitizeTransferValue(remark3),
              serialNumber
            ]);

            if (updateResult.affectedRows > 0) {
              await syncTrackingFieldsBySerial(rowConnection, serialNumber, {
                transport_mode: sanitizeTransferValue(transport_mode),
                transport_supplier: sharedFields.transport_supplier,
                cargo_flow_info: sharedFields.cargo_flow_info,
                remark1: sharedFields.remark1,
                remark2: sharedFields.remark2,
                excludeTables: ["transfer"],
              });
            }

            await rowConnection.commit();
          } catch (rowError) {
            if (rowTransactionStarted) {
              await rowConnection.rollback();
            }
            throw rowError;
          } finally {
            rowConnection.release();
          }

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
    "供应商": "transport_supplier",
    "运输供应商": "transport_supplier",
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

function validateTransferExcelDataOverrideMarker() {
  return true;
}

function validateTransferExcelData(data) {
  const result = {
    isValid: true,
    errors: [],
    data: {}
  };

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
    "供应商": "transport_supplier",
    "运输供应商": "transport_supplier",
    "增值服务备注": "value_added_services",
    "账单期": "billing_period",
    "备注1": "remark1",
    "备注2": "remark2",
    "备注3": "remark3"
  };

  const requiredFields = ["tracking_number"];

  for (const [excelField, dbField] of Object.entries(fieldMapping)) {
    if (data[excelField] !== undefined && data[excelField] !== null && data[excelField] !== "") {
      result.data[dbField] = data[excelField];
    }
  }

  for (const field of requiredFields) {
    if (!result.data[field] || result.data[field].toString().trim() === "") {
      const excelFieldNames = Object.keys(fieldMapping).filter((key) => fieldMapping[key] === field);
      const excelFieldName = excelFieldNames.length > 0 ? excelFieldNames[0] : field;
      result.errors.push(`"${excelFieldName}" 字段为空，请检查Excel文件`);
      result.isValid = false;
    }
  }

  const dateFields = ["pickup_date"];
  for (const field of dateFields) {
    const excelFieldName = Object.keys(fieldMapping).find((key) => fieldMapping[key] === field) || field;
    const normalizedField = normalizeOptionalDateField(result.data[field], excelFieldName, { allowExcelSerial: true });
    if (normalizedField.error) {
      result.errors.push(normalizedField.error);
      result.isValid = false;
    } else if (normalizedField.value) {
      result.data[field] = normalizedField.value;
    } else {
      delete result.data[field];
    }
  }

  const datetimeFields = ["arrival_port_time", "clearance_time", "delivery_time", "complete_docs_send_time"];
  for (const field of datetimeFields) {
    const excelFieldName = Object.keys(fieldMapping).find((key) => fieldMapping[key] === field) || field;
    const normalizedField = normalizeOptionalDateField(result.data[field], excelFieldName, {
      includeTime: true,
      allowExcelSerial: true
    });
    if (normalizedField.error) {
      result.errors.push(normalizedField.error);
      result.isValid = false;
    } else if (normalizedField.value) {
      result.data[field] = normalizedField.value;
    } else {
      delete result.data[field];
    }
  }

  return result;
}
