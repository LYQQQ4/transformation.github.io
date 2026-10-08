const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const {
  ORDER_IMPORT_FIELDS,
  buildOrderImportFieldMapping,
  getOrderImportHeaders,
  getPostEnrichRequiredOrderImportFields,
  getPreEnrichRequiredOrderImportFields,
  getRequiredOrderImportFields,
} = require("../lib/order_import_schema");
const {
  buildFilledStatusSql,
  enrichOrderBillingFields,
  ensureBillingInfoSchema,
} = require("../lib/reporting");
const { createHttpError, requireAdminAccess } = require("../lib/request_auth");
const { validateUserProfileId } = require("../lib/user_profiles");
const { syncTrackingFieldsBySerial } = require("../lib/tracking_sync");
const {
  validateUnifiedBatchDateRequest,
} = require("../lib/batch_date");

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

function normalizeOrderImportValue(value) {
  return String(value || "").trim();
}

const ORDER_PHONE_MAX_LENGTH = 255;
let orderPhoneSchemaReadyPromise = null;

function normalizeOrderPhoneValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim().slice(0, ORDER_PHONE_MAX_LENGTH);
}

async function ensureOrderPhoneSchema(db) {
  if (!orderPhoneSchemaReadyPromise) {
    orderPhoneSchemaReadyPromise = (async () => {
      const columnDefinitions = [
        { table: "orders", column: "sender_phone", sql: "ALTER TABLE orders MODIFY COLUMN sender_phone VARCHAR(255) NOT NULL" },
        { table: "orders", column: "receiver_phone", sql: "ALTER TABLE orders MODIFY COLUMN receiver_phone VARCHAR(255) NOT NULL" },
        { table: "sender_info", column: "sender_phone", sql: "ALTER TABLE sender_info MODIFY COLUMN sender_phone VARCHAR(255) DEFAULT NULL" },
        { table: "customer_info", column: "receiver_phone", sql: "ALTER TABLE customer_info MODIFY COLUMN receiver_phone VARCHAR(255) DEFAULT NULL" },
      ];

      for (const definition of columnDefinitions) {
        const [rows] = await db.execute(
          `SELECT CHARACTER_MAXIMUM_LENGTH AS max_length
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = ?
             AND COLUMN_NAME = ?`,
          [definition.table, definition.column]
        );

        if (!rows.length) {
          continue;
        }

        const currentLength = Number(rows[0].max_length || 0);
        if (currentLength < ORDER_PHONE_MAX_LENGTH) {
          await db.execute(definition.sql);
        }
      }

      const [receiveDateColumns] = await db.execute(
        `SELECT IS_NULLABLE AS is_nullable
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'orders'
           AND COLUMN_NAME = 'receive_date'`
      );

      if (receiveDateColumns.length && receiveDateColumns[0].is_nullable === "NO") {
        await db.execute("ALTER TABLE orders MODIFY COLUMN receive_date DATE DEFAULT NULL COMMENT '接收指令日期'");
      }
    })().catch((error) => {
      orderPhoneSchemaReadyPromise = null;
      throw error;
    });
  }

  return orderPhoneSchemaReadyPromise;
}

function buildOrderSelectSql(whereClause = "") {
  return `
    SELECT
      o.*,
      p.customs_title AS index_title,
      p.pickup_date AS pickup_date,
      c.customs_start_time AS customs_start_time,
      c.tax_payment_time AS tax_payment_time,
      c.release_time AS release_time,
      COALESCE(t.arrival_port_time, p.arrival_time) AS arrival_time,
      t.complete_docs_send_time AS complete_docs_send_time,
      t.billing_period AS billing_period_raw,
      b.billing_completed_time AS billing_completed_time,
      b.cost_items AS cost_items_raw,
      b.billing_items AS billing_items_raw,
      pkg.pieces_total
    FROM orders o
    LEFT JOIN pickup_transport_tracking p ON p.serial_number = o.serial_number
    LEFT JOIN customs_clearance_tracking c ON c.serial_number = o.serial_number
    LEFT JOIN transfer t ON t.serial_number = o.serial_number
    LEFT JOIN billing_info b ON b.serial_number = o.serial_number
    LEFT JOIN (
      SELECT serial_number, SUM(COALESCE(pieces, 0)) AS pieces_total
      FROM \`package\`
      GROUP BY serial_number
    ) pkg ON pkg.serial_number = o.serial_number
    ${whereClause}
  `;
}

async function collectOrderUserIdErrors(userDb, customerId, senderId, options = {}) {
  const {
    requireCustomerId = true,
    requireSenderId = false,
    validateFormat = false,
  } = options;
  const errors = [];

  const normalizedCustomerId = normalizeOrderImportValue(customerId);
  const normalizedSenderId = normalizeOrderImportValue(senderId);

  if (requireSenderId && !normalizedSenderId) {
    errors.push("发件人ID不能为空");
  }

  if (requireCustomerId && !normalizedCustomerId) {
    errors.push("客户ID不能为空");
  }

  const idsToCheck = [];
  const seenIds = new Set();
  const pushIdForLookup = (id) => {
    if (!id || seenIds.has(id)) {
      return;
    }
    seenIds.add(id);
    idsToCheck.push(id);
  };

  if (validateFormat && normalizedSenderId && !validateUserProfileId(normalizedSenderId)) {
    errors.push(`发件人ID格式不正确，请使用统一用户库ID格式（如 ch001）：${normalizedSenderId}`);
  } else if (normalizedSenderId) {
    pushIdForLookup(normalizedSenderId);
  }

  if (validateFormat && normalizedCustomerId && !validateUserProfileId(normalizedCustomerId)) {
    errors.push(`客户ID格式不正确，请使用统一用户库ID格式（如 ch001）：${normalizedCustomerId}`);
  } else if (normalizedCustomerId) {
    pushIdForLookup(normalizedCustomerId);
  }

  if (!userDb || !idsToCheck.length) {
    return errors;
  }

  const placeholders = idsToCheck.map(() => "?").join(", ");
  const [rows] = await userDb.execute(
    `SELECT id FROM user_profiles WHERE id IN (${placeholders})`,
    idsToCheck
  );

  const existingIds = new Set(rows.map((row) => row.id));

  if (normalizedSenderId && !existingIds.has(normalizedSenderId) && validateUserProfileId(normalizedSenderId)) {
    errors.push(`发件人ID不存在于统一用户库：${normalizedSenderId}`);
  }

  if (normalizedCustomerId && !existingIds.has(normalizedCustomerId) && validateUserProfileId(normalizedCustomerId)) {
    errors.push(`客户ID不存在于统一用户库：${normalizedCustomerId}`);
  }

  return errors;
}

async function validateOrderUserIds(userDb, customerId, senderId) {
  if (!userDb) {
    return;
  }

  const normalizedCustomerId = String(customerId || "").trim();
  const normalizedSenderId = String(senderId || "").trim();

  if (!normalizedCustomerId) {
    const error = new Error("客户ID不能为空");
    error.statusCode = 400;
    throw error;
  }

  const ids = [normalizedCustomerId];
  if (normalizedSenderId) {
    ids.push(normalizedSenderId);
  }

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await userDb.execute(
    `SELECT id FROM user_profiles WHERE id IN (${placeholders})`,
    ids
  );

  const existingIds = new Set(rows.map((row) => row.id));
  if (!existingIds.has(normalizedCustomerId)) {
    const error = new Error(`客户ID不存在于用户信息库: ${normalizedCustomerId}`);
    error.statusCode = 400;
    throw error;
  }

  if (normalizedSenderId && !existingIds.has(normalizedSenderId)) {
    const error = new Error(`发件人ID不存在于用户信息库: ${normalizedSenderId}`);
    error.statusCode = 400;
    throw error;
  }
}

async function fetchOrderUserProfiles(userDb, customerId, senderId) {
  if (!userDb) {
    return {};
  }

  const ids = [normalizeOrderImportValue(customerId), normalizeOrderImportValue(senderId)].filter(Boolean);
  if (!ids.length) {
    return {};
  }

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await userDb.execute(
    `SELECT id, company_name, address, contact_name, phone FROM user_profiles WHERE id IN (${placeholders})`,
    ids
  );

  return rows.reduce((accumulator, row) => {
    accumulator[row.id] = row;
    return accumulator;
  }, {});
}

async function enrichOrderPayloadFromProfiles(userDb, payload) {
  const normalizedPayload = { ...payload };
  const profiles = await fetchOrderUserProfiles(userDb, normalizedPayload.customer_id, normalizedPayload.sender_id);
  const customerProfile = profiles[normalizeOrderImportValue(normalizedPayload.customer_id)];
  const senderProfile = profiles[normalizeOrderImportValue(normalizedPayload.sender_id)];

  if (customerProfile) {
    normalizedPayload.delivery_address = normalizedPayload.delivery_address || customerProfile.address || "";
    normalizedPayload.receiver_name = normalizedPayload.receiver_name || customerProfile.contact_name || "";
    normalizedPayload.receiver_phone = normalizedPayload.receiver_phone || customerProfile.phone || "";
  }

  if (senderProfile) {
    normalizedPayload.shipping_address = normalizedPayload.shipping_address || senderProfile.address || "";
    normalizedPayload.sender_name = normalizedPayload.sender_name || senderProfile.contact_name || "";
    normalizedPayload.sender_phone = normalizedPayload.sender_phone || senderProfile.phone || "";
  }

  normalizedPayload.sender_phone = normalizeOrderPhoneValue(normalizedPayload.sender_phone);
  normalizedPayload.receiver_phone = normalizeOrderPhoneValue(normalizedPayload.receiver_phone);

  return normalizedPayload;
}

async function enrichOrderPayloadWithUserProfiles(userDb, payload) {
  await validateOrderUserIds(userDb, payload.customer_id, payload.sender_id);
  return enrichOrderPayloadFromProfiles(userDb, payload);
}

function normalizeOptionalDateValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? "" : trimmed;
  }
  return value;
}

function normalizeBatchReceiveDate(value) {
  const normalized = normalizeOptionalDateValue(value);
  if (typeof normalized !== "string") {
    return null;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return normalized;
}

function normalizeBatchSerialNumbers(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const serialNumbers = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return null;
    }

    const serialNumber = item.trim();
    if (!seen.has(serialNumber)) {
      seen.add(serialNumber);
      serialNumbers.push(serialNumber);
    }
  }

  return serialNumbers.length > 0 ? serialNumbers : null;
}

function validateRequiredFields(payload, requiredFields, fieldMapping) {
  const errors = [];

  for (const field of requiredFields) {
    if (!payload[field] || String(payload[field]).trim() === "") {
      const excelFieldNames = Object.keys(fieldMapping).filter((key) => fieldMapping[key] === field);
      const excelFieldName = excelFieldNames.length > 0 ? excelFieldNames[0] : field;
      errors.push(`"${excelFieldName}" 字段为空，请检查Excel文件`);
    }
  }

  return errors;
}

module.exports = (db, userDb = null) => {
  router.get("/import-template", async (req, res) => {
    try {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([getOrderImportHeaders()]);
      XLSX.utils.book_append_sheet(workbook, worksheet, "订单导入模板");

      const requiredFields = new Set(getRequiredOrderImportFields());
      const noteSheetRows = [
        ["\u5b57\u6bb5", "\u8bf4\u660e"],
        ...ORDER_IMPORT_FIELDS.map((field) => {
          const notes = [];
          notes.push(requiredFields.has(field.key) ? "\u5fc5\u586b" : "\u9009\u586b");
          if (field.key === "receive_date") {
            notes.push("\u683c\u5f0f: YYYY-MM-DD \u6216 YYYY/MM/DD");
          }
          if (field.key === "sender_id") {
            notes.push("\u8bf7\u5148\u586b\u5199\u53d1\u4ef6\u4ebaID\uff0c\u4e14\u5fc5\u987b\u6765\u81ea\u7edf\u4e00\u7528\u6237\u5e93");
            notes.push("\u6821\u9a8c\u5931\u8d25\u65f6\u4f1a\u6309\u884c\u8fd4\u56de\u5931\u8d25\u539f\u56e0");
          }
          if (field.key === "customer_id") {
            notes.push("\u8bf7\u540e\u586b\u5199\u5ba2\u6237ID\uff0c\u4e14\u5fc5\u987b\u6765\u81ea\u7edf\u4e00\u7528\u6237\u5e93");
            notes.push("\u6821\u9a8c\u5931\u8d25\u65f6\u4f1a\u6309\u884c\u8fd4\u56de\u5931\u8d25\u539f\u56e0");
          }
          return [field.label, notes.join("\uff1b")];
        }),
      ];
      const noteWorksheet = XLSX.utils.aoa_to_sheet(noteSheetRows);
      XLSX.utils.book_append_sheet(workbook, noteWorksheet, "填写说明");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="order_import_template.xlsx"');
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate import template: " + error.message });
    }
  });

  // GET all orders
  router.get("/", async (req, res) => {
    try {
      await ensureOrderPhoneSchema(db);
      await ensureBillingInfoSchema(db);
      const conditions = [];
      const params = [];

      const appendLikeCondition = (fieldName, columnName = fieldName) => {
        const value = String(req.query[fieldName] || "").trim();
        if (!value) {
          return;
        }
        conditions.push(`${columnName} LIKE ?`);
        params.push(`%${value}%`);
      };

      const appendFilledStatusCondition = (fieldName, columnName) => {
        const filledStatus = String(req.query[fieldName] || "all").trim();
        if (filledStatus === "filled") {
          conditions.push(`${columnName} IS NOT NULL`);
        } else if (filledStatus === "unfilled") {
          conditions.push(`${columnName} IS NULL`);
        }
      };

      appendLikeCondition("company_name", "o.company_name");
      appendLikeCondition("orderer", "o.orderer");
      appendLikeCondition("business_type", "o.business_type");
      appendLikeCondition("customer_id", "o.customer_id");
      appendLikeCondition("sender_id", "o.sender_id");
      appendLikeCondition("origin", "o.origin");
      appendLikeCondition("destination", "o.destination");
      appendLikeCondition("index_title", "p.customs_title");

      appendFilledStatusCondition("dateFilledStatus", "o.receive_date");
      appendFilledStatusCondition("pickup_date_filled_status", "p.pickup_date");
      appendFilledStatusCondition("customs_start_time_filled_status", "c.customs_start_time");
      appendFilledStatusCondition("tax_payment_time_filled_status", "c.tax_payment_time");
      appendFilledStatusCondition("release_time_filled_status", "c.release_time");
      appendFilledStatusCondition("arrival_time_filled_status", "p.arrival_time");
      appendFilledStatusCondition("complete_docs_send_time_filled_status", "t.complete_docs_send_time");
      const billingCompletedTimeFilledStatus = String(req.query.billing_completed_time_filled_status || "all").trim();
      const billingCompletedTimeCondition = buildFilledStatusSql("b.billing_completed_time", billingCompletedTimeFilledStatus);
      if (billingCompletedTimeCondition) {
        conditions.push(billingCompletedTimeCondition);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [rows] = await db.execute(`${buildOrderSelectSql(whereClause)} ORDER BY o.serial_number DESC`, params);
      res.json({ orders: rows.map((row) => enrichOrderBillingFields(row)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single order by serial_number
  router.get("/serial/:serial_number", async (req, res) => {
    try {
      await ensureOrderPhoneSchema(db);
      await ensureBillingInfoSchema(db);
      const [rows] = await db.execute(
        `${buildOrderSelectSql("WHERE o.serial_number = ?")}
         LIMIT 1`,
        [req.params.serial_number]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      res.json({ order: enrichOrderBillingFields(rows[0]) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single order by id
  router.get("/:id", async (req, res) => {
    try {
      await ensureOrderPhoneSchema(db);
      await ensureBillingInfoSchema(db);
      const [rows] = await db.execute(
        `${buildOrderSelectSql("WHERE o.id = ?")}
         LIMIT 1`,
        [req.params.id]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      res.json({ order: enrichOrderBillingFields(rows[0]) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unified batch date entry point for the order list page.
  router.put("/batch-date", async (req, res) => {
    let connection = null;
    let transactionStarted = false;

    try {
      await requireAdminAccess(userDb, req, "统一批量日期修改");
      const validated = validateUnifiedBatchDateRequest(req.body);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }

      const { field, definition, serialNumbers, value } = validated;
      if (definition.moduleName === "billing") {
        await ensureBillingInfoSchema(db);
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      const placeholders = serialNumbers.map(() => "?").join(", ");
      const lookupTableName = definition.moduleName === "billing"
        ? "orders"
        : definition.tableName;
      const [existingRows] = await connection.execute(
        `SELECT serial_number FROM ${lookupTableName} WHERE serial_number IN (${placeholders})`,
        serialNumbers
      );
      const existingSerialNumbers = new Set(
        existingRows.map((row) => String(row.serial_number || "").trim())
      );
      const foundSerialNumbers = serialNumbers.filter((serialNumber) => existingSerialNumbers.has(serialNumber));
      const notFoundSerialNumbers = serialNumbers.filter((serialNumber) => !existingSerialNumbers.has(serialNumber));

      if (definition.moduleName === "billing") {
        for (const serialNumber of foundSerialNumbers) {
          await connection.execute(
            `INSERT INTO ${definition.tableName} (serial_number, ${definition.columnName})
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE ${definition.columnName} = VALUES(${definition.columnName})`,
            [serialNumber, value]
          );
        }
      } else if (foundSerialNumbers.length > 0) {
        const updatePlaceholders = foundSerialNumbers.map(() => "?").join(", ");
        await connection.execute(
          `UPDATE ${definition.tableName}
           SET ${definition.columnName} = ?
           WHERE serial_number IN (${updatePlaceholders})`,
          [value, ...foundSerialNumbers]
        );

        if (definition.moduleName === "pickup" || definition.moduleName === "transfer") {
          const syncField = field === "transfer_pickup_date"
            ? "pickup_date"
            : (field === "pickup_arrival_time" ? "arrival_time" : field);
          const shouldSync = definition.moduleName === "pickup" ||
            syncField === "pickup_date" ||
            syncField === "arrival_port_time";
          if (shouldSync) {
            for (const serialNumber of foundSerialNumbers) {
              await syncTrackingFieldsBySerial(connection, serialNumber, {
                [syncField]: value,
                excludeTables: [definition.tableName],
              });
            }
          }
        }
      }

      await connection.commit();
      transactionStarted = false;
      return res.json({
        message: "批量填写日期成功",
        field,
        updated_count: foundSerialNumbers.length,
        not_found_serial_numbers: notFoundSerialNumbers,
      });
    } catch (err) {
      if (connection && transactionStarted) {
        await connection.rollback();
      }
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  });

  router.put("/batch-receive-date", async (req, res) => {
    let connection = null;
    let transactionStarted = false;

    try {
      await requireAdminAccess(userDb, req, "批量填写接收指令日期");

      const serialNumbers = normalizeBatchSerialNumbers(req.body?.serial_numbers);
      if (!serialNumbers) {
        return res.status(400).json({ error: "serial_numbers must be a non-empty array of strings" });
      }

      if (req.body?.field !== undefined && req.body.field !== "receive_date") {
        return res.status(400).json({ error: "field is not allowed for this module" });
      }

      const receiveDate = normalizeBatchReceiveDate(
        req.body?.receive_date ?? req.body?.value
      );
      if (!receiveDate) {
        return res.status(400).json({ error: "receive_date must be a valid YYYY-MM-DD date" });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      const placeholders = serialNumbers.map(() => "?").join(", ");
      const [existingRows] = await connection.execute(
        `SELECT serial_number FROM orders WHERE serial_number IN (${placeholders})`,
        serialNumbers
      );
      const existingSerialNumbers = new Set(
        existingRows.map((row) => String(row.serial_number || "").trim())
      );
      const foundSerialNumbers = serialNumbers.filter((serialNumber) => existingSerialNumbers.has(serialNumber));
      const notFoundSerialNumbers = serialNumbers.filter((serialNumber) => !existingSerialNumbers.has(serialNumber));

      if (foundSerialNumbers.length > 0) {
        const updatePlaceholders = foundSerialNumbers.map(() => "?").join(", ");
        await connection.execute(
          `UPDATE orders SET receive_date = ? WHERE serial_number IN (${updatePlaceholders})`,
          [receiveDate, ...foundSerialNumbers]
        );
      }

      await connection.commit();
      transactionStarted = false;

      return res.json({
        message: "批量填写接收指令日期完成",
        module: "order",
        field: "receive_date",
        receive_date: receiveDate,
        value: receiveDate,
        updated_count: foundSerialNumbers.length,
        not_found_serial_numbers: notFoundSerialNumbers,
      });
    } catch (err) {
      if (connection && transactionStarted) {
        await connection.rollback();
      }
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  });

  // POST create new order
  router.post("/", async (req, res) => {
    const connection = await db.getConnection();
    try {
      await ensureOrderPhoneSchema(db);
      const company_name = String(req.body?.company_name ?? "").trim();
      if (!company_name) {
        res.status(400).json({ error: "公司抬头不能为空，请手动填写" });
        return;
      }
      await connection.beginTransaction();

      const orderer = req.body.orderer;
      const receive_date = req.body.receive_date;
      const business_type = req.body.business_type;
      const customer_id = req.body.customer_id;
      const sender_id = req.body.sender_id;
      const shipping_address = req.body.shipping_address;
      const sender_name = req.body.sender_name;
      const sender_phone = req.body.sender_phone;
      const delivery_address = req.body.delivery_address;
      const receiver_name = req.body.receiver_name;
      const receiver_phone = req.body.receiver_phone;
      const origin = req.body.origin;
      const destination = req.body.destination;
      const trade_term = req.body.trade_term;
      const product_name = req.body.product_name;
      const remark1 = req.body.remark1;
      const remark2 = req.body.remark2;
      const enrichedOrderData = await enrichOrderPayloadWithUserProfiles(userDb, {
        company_name,
        orderer,
        receive_date,
        business_type,
        customer_id,
        sender_id,
        shipping_address,
        sender_name,
        sender_phone,
        delivery_address,
        receiver_name,
        receiver_phone,
        origin,
        destination,
        trade_term,
        product_name,
        remark1,
        remark2,
      });
      const normalizedReceiveDate = normalizeOptionalDateValue(enrichedOrderData.receive_date) || null;

      // 生成serial_number：当年+当月+001，最后三位递增，每月重置
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = String(now.getMonth() + 1).padStart(2, "0"); // 月份从0开始，需要+1
      const yearMonthPrefix = `${currentYear}${currentMonth}`;

      // 使用原子操作生成唯一的serial_number
      let serialNumber;
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        // 查询该月已存在的最大serial_number
        const [existingOrders] = await connection.execute(
          "SELECT serial_number FROM orders WHERE serial_number LIKE ? ORDER BY serial_number DESC LIMIT 1 FOR UPDATE",
          [`${yearMonthPrefix}%`]
        );

        let nextSequence = 1;
        if (existingOrders.length > 0) {
          const lastSerialNumber = existingOrders[0].serial_number;
          const lastSequence = parseInt(lastSerialNumber.slice(-3)); // 获取最后三位数字
          nextSequence = lastSequence + 1;
        }

        // 生成新的serial_number，格式：YYYYMM001, YYYYMM002等
        serialNumber = `${yearMonthPrefix}${String(nextSequence).padStart(3, "0")}`;

        // 尝试插入orders表，如果serial_number已存在会失败
        try {
          const sql = "INSERT INTO orders (company_name, orderer, receive_date, business_type, customer_id, sender_id, shipping_address, sender_name, sender_phone, delivery_address, receiver_name, receiver_phone, origin, destination, trade_term, product_name, remark1, remark2, serial_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
          const [result] = await connection.execute(sql, [enrichedOrderData.company_name, enrichedOrderData.orderer, normalizedReceiveDate, enrichedOrderData.business_type, enrichedOrderData.customer_id, enrichedOrderData.sender_id || null, enrichedOrderData.shipping_address, enrichedOrderData.sender_name, enrichedOrderData.sender_phone, enrichedOrderData.delivery_address, enrichedOrderData.receiver_name, enrichedOrderData.receiver_phone, enrichedOrderData.origin, enrichedOrderData.destination, enrichedOrderData.trade_term || null, enrichedOrderData.product_name || null, enrichedOrderData.remark1 || null, enrichedOrderData.remark2 || null, serialNumber]);

          // 同时在package表中插入记录，使用相同的serial_number，只填入serial_number，其他字段为空
          const packageSql = "INSERT INTO \`package\` (serial_number, package_label, package_order) VALUES (?, ?, ?)";
          await connection.execute(packageSql, [serialNumber, "包装1", 1]);

          // transfer.tracking_number 有唯一约束，创建订单时需写入唯一运单号避免重复键冲突。
          const transferSql = "INSERT INTO transfer (serial_number, tracking_number) VALUES (?, ?)";
          await connection.execute(transferSql, [serialNumber, `TN${serialNumber}`]);

          // 同时在pickup_transport_tracking表中插入记录，使用相同的serial_number
          const pickupTrackingSql = "INSERT INTO pickup_transport_tracking (serial_number) VALUES (?)";
          await connection.execute(pickupTrackingSql, [serialNumber]);

          // 同时在customs_clearance_tracking表中插入记录，使用相同的serial_number
          const customsClearanceSql = "INSERT INTO customs_clearance_tracking (serial_number) VALUES (?)";
          await connection.execute(customsClearanceSql, [serialNumber]);

          await connection.commit();
          res.json({ id: result.insertId, serial_number: serialNumber, message: "Order created successfully" });
          return;
        } catch (insertError) {
          // 如果是重复键错误，说明serial_number已被其他事务占用，重试
          if (insertError.code === 'ER_DUP_ENTRY') {
            attempts++;
            await connection.rollback();
            await connection.beginTransaction();
            continue;
          } else {
            // 其他错误，直接抛出
            throw insertError;
          }
        }
      }

      // 超过最大重试次数
      throw new Error("Failed to generate unique serial number after maximum attempts");

    } catch (err) {
      await connection.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  // PUT update order
  router.put("/:id", async (req, res) => {
    try {
      await ensureOrderPhoneSchema(db);
      const company_name = String(req.body?.company_name ?? "").trim();
      if (!company_name) {
        res.status(400).json({ error: "公司抬头不能为空，请手动填写" });
        return;
      }
      const orderer = req.body.orderer;
      const receive_date = req.body.receive_date;
      const business_type = req.body.business_type;
      const customer_id = req.body.customer_id;
      const sender_id = req.body.sender_id;
      const shipping_address = req.body.shipping_address;
      const sender_name = req.body.sender_name;
      const sender_phone = req.body.sender_phone;
      const delivery_address = req.body.delivery_address;
      const receiver_name = req.body.receiver_name;
      const receiver_phone = req.body.receiver_phone;
      const origin = req.body.origin;
      const destination = req.body.destination;
      const trade_term = req.body.trade_term;
      const product_name = req.body.product_name;
      const remark1 = req.body.remark1;
      const remark2 = req.body.remark2;
      const enrichedOrderData = await enrichOrderPayloadWithUserProfiles(userDb, {
        company_name,
        orderer,
        receive_date,
        business_type,
        customer_id,
        sender_id,
        shipping_address,
        sender_name,
        sender_phone,
        delivery_address,
        receiver_name,
        receiver_phone,
        origin,
        destination,
        trade_term,
        product_name,
        remark1,
        remark2,
      });
      const normalizedReceiveDate = normalizeOptionalDateValue(enrichedOrderData.receive_date) || null;

      const sql = "UPDATE orders SET company_name = ?, orderer = ?, receive_date = ?, business_type = ?, customer_id = ?, sender_id = ?, shipping_address = ?, sender_name = ?, sender_phone = ?, delivery_address = ?, receiver_name = ?, receiver_phone = ?, origin = ?, destination = ?, trade_term = ?, product_name = ?, remark1 = ?, remark2 = ? WHERE id = ?";
      const [result] = await db.execute(sql, [enrichedOrderData.company_name, enrichedOrderData.orderer, normalizedReceiveDate, enrichedOrderData.business_type, enrichedOrderData.customer_id, enrichedOrderData.sender_id || null, enrichedOrderData.shipping_address, enrichedOrderData.sender_name, enrichedOrderData.sender_phone, enrichedOrderData.delivery_address, enrichedOrderData.receiver_name, enrichedOrderData.receiver_phone, enrichedOrderData.origin, enrichedOrderData.destination, enrichedOrderData.trade_term || null, enrichedOrderData.product_name || null, enrichedOrderData.remark1 || null, enrichedOrderData.remark2 || null, req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      res.json({ message: "Order updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE order
  router.delete("/delete-management/:id", async (req, res) => {
    const connection = await db.getConnection();
    try {
      await requireAdminAccess(userDb, req, "删单管理");
      const deleteSource = String(req.headers["x-order-delete-source"] || "").trim();
      if (deleteSource !== "delete-management") {
        throw createHttpError(403, "请通过删单管理页面执行删除操作");
      }

      await connection.beginTransaction();

      // 首先获取订单的serial_number
      const [orderRows] = await connection.execute("SELECT serial_number FROM orders WHERE id = ?", [req.params.id]);
      if (orderRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: "Order not found" });
        return;
      }

      const serialNumber = orderRows[0].serial_number;

      // 删除相关的物流信息（transfer表）
      await connection.execute("DELETE FROM transfer WHERE serial_number = ?", [serialNumber]);

      // 删除相关的提货运输跟踪信息（pickup_transport_tracking表）
      await connection.execute("DELETE FROM pickup_transport_tracking WHERE serial_number = ?", [serialNumber]);

      // 删除相关的报关信息（customs_clearance_tracking表）
      await connection.execute("DELETE FROM customs_clearance_tracking WHERE serial_number = ?", [serialNumber]);

      // 删除相关的包装信息（package表）
      await connection.execute("DELETE FROM \`package\` WHERE serial_number = ?", [serialNumber]);
      await connection.execute("DELETE FROM billing_info WHERE serial_number = ?", [serialNumber]);

      // 最后删除订单信息（orders表）
      const [result] = await connection.execute("DELETE FROM orders WHERE id = ?", [req.params.id]);

      await connection.commit();
      res.json({ message: "Order and related package and transfer information deleted successfully" });
    } catch (err) {
      await connection.rollback();
      res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  // POST parse Excel file (单行预览)
  router.delete("/:id", async (req, res) => {
    res.status(403).json({ error: "删除入口已迁移至删单管理页面，请使用专用删单接口" });
  });

  router.post("/parse-excel", upload.single("excelFile"), async (req, res) => {
    try {
      await ensureOrderPhoneSchema(db);
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
      const validationResult = validateExcelData(excelData);

      if (!validationResult.isValid) {
        return res.status(400).json({
          error: "数据验证失败",
          details: validationResult.errors
        });
      }

      const userIdErrors = await collectOrderUserIdErrors(
        userDb,
        validationResult.data.customer_id,
        validationResult.data.sender_id,
        {
          requireCustomerId: true,
          requireSenderId: true,
          validateFormat: true,
        }
      );
      if (userIdErrors.length > 0) {
        return res.status(400).json({
          error: "\u6570\u636e\u9a8c\u8bc1\u5931\u8d25",
          details: userIdErrors
        });
      }

      validationResult.data = await enrichOrderPayloadFromProfiles(userDb, validationResult.data);
      const postEnrichErrors = validateRequiredFields(
        validationResult.data,
        getPostEnrichRequiredOrderImportFields(),
        buildOrderImportFieldMapping()
      );
      if (postEnrichErrors.length > 0) {
        return res.status(400).json({
          error: "数据验证失败",
          details: postEnrichErrors
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
    const connection = await db.getConnection();
    try {
      await ensureOrderPhoneSchema(db);
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

        const rowConnection = await db.getConnection();
        try {
          await rowConnection.beginTransaction();

          // 验证数据
          const validationResult = validateExcelData(rowData);

          if (!validationResult.isValid) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: validationResult.errors
            });
            await rowConnection.rollback();
            continue;
          }

          const userIdErrors = await collectOrderUserIdErrors(
            userDb,
            validationResult.data.customer_id,
            validationResult.data.sender_id,
            {
              requireCustomerId: true,
              requireSenderId: true,
              validateFormat: true,
            }
          );
          if (userIdErrors.length > 0) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: userIdErrors
            });
            await rowConnection.rollback();
            continue;
          }

          const enrichedOrderData = await enrichOrderPayloadFromProfiles(userDb, validationResult.data);
          const postEnrichErrors = validateRequiredFields(
            enrichedOrderData,
            getPostEnrichRequiredOrderImportFields(),
            buildOrderImportFieldMapping()
          );
          if (postEnrichErrors.length > 0) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: postEnrichErrors
            });
            await rowConnection.rollback();
            continue;
          }

          // 生成serial_number：当年+当月+001，最后三位递增，每月重置
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
          const yearMonthPrefix = `${currentYear}${currentMonth}`;

          // 使用原子操作生成唯一的serial_number
          let serialNumber;
          let attempts = 0;
          const maxAttempts = 50; // 增加重试次数

          while (attempts < maxAttempts) {
            // 查询该月已存在的最大serial_number
            const [existingOrders] = await rowConnection.execute(
              "SELECT serial_number FROM orders WHERE serial_number LIKE ? ORDER BY serial_number DESC LIMIT 1 FOR UPDATE",
              [`${yearMonthPrefix}%`]
            );

            let nextSequence = 1;
            if (existingOrders.length > 0) {
              const lastSerialNumber = existingOrders[0].serial_number;
              const lastSequence = parseInt(lastSerialNumber.slice(-3));
              nextSequence = lastSequence + 1;
            }

            // 如果重试多次，尝试跳过一些序列号以避免冲突
            if (attempts > 5) {
              nextSequence += Math.floor(Math.random() * 10) + 1; // 随机跳跃
            }

            serialNumber = `${yearMonthPrefix}${String(nextSequence).padStart(3, "0")}`;

            // 尝试插入所有表
            try {
              const sql = "INSERT INTO orders (company_name, orderer, receive_date, business_type, customer_id, sender_id, shipping_address, sender_name, sender_phone, delivery_address, receiver_name, receiver_phone, origin, destination, trade_term, product_name, remark1, remark2, serial_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
              const normalizedImportReceiveDate = normalizeOptionalDateValue(enrichedOrderData.receive_date) || null;
              const [insertResult] = await rowConnection.execute(sql, [enrichedOrderData.company_name, enrichedOrderData.orderer, normalizedImportReceiveDate, enrichedOrderData.business_type, enrichedOrderData.customer_id, enrichedOrderData.sender_id || null, enrichedOrderData.shipping_address, enrichedOrderData.sender_name, enrichedOrderData.sender_phone, enrichedOrderData.delivery_address, enrichedOrderData.receiver_name, enrichedOrderData.receiver_phone, enrichedOrderData.origin, enrichedOrderData.destination, enrichedOrderData.trade_term || null, enrichedOrderData.product_name || null, enrichedOrderData.remark1 || null, enrichedOrderData.remark2 || null, serialNumber]);

              // 同时在package表中插入记录，使用相同的serial_number
              const packageSql = "INSERT INTO \`package\` (serial_number, package_label, package_order) VALUES (?, ?, ?)";
              await rowConnection.execute(packageSql, [serialNumber, "包装1", 1]);

              // 同时在transfer表中插入记录，使用相同的serial_number
              const transferSql = "INSERT INTO transfer (serial_number, tracking_number) VALUES (?, ?)";
              await rowConnection.execute(transferSql, [serialNumber, `TN${serialNumber}`]);

              // 同时在pickup_transport_tracking表中插入记录，使用相同的serial_number
              const pickupTrackingSql = "INSERT INTO pickup_transport_tracking (serial_number) VALUES (?)";
              await rowConnection.execute(pickupTrackingSql, [serialNumber]);

              // 同时在customs_clearance_tracking表中插入记录，使用相同的serial_number
              const customsClearanceSql = "INSERT INTO customs_clearance_tracking (serial_number) VALUES (?)";
              await rowConnection.execute(customsClearanceSql, [serialNumber]);

              await rowConnection.commit();

              results.success++;
              results.successfulImports.push({
                id: insertResult.insertId,
                serial_number: serialNumber,
                row: rowNumber
              });
              break; // 成功后跳出重试循环

            } catch (insertError) {
              // 如果是重复键错误，重试生成serial_number
              if (insertError.code === 'ER_DUP_ENTRY') {
                attempts++;
                await rowConnection.rollback();
                await rowConnection.beginTransaction();

                // 添加短暂延迟以减少竞争
                if (attempts > 10) {
                  await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
                }

                continue;
              } else {
                // 其他错误，直接抛出
                throw insertError;
              }
            }
          }

          if (attempts >= maxAttempts) {
            results.failed++;
            results.errors.push({
              row: rowNumber,
              errors: [`生成唯一序列号失败：超过最大重试次数(${maxAttempts})`]
            });
          }

        } catch (error) {
          await rowConnection.rollback();
          results.failed++;
          results.errors.push({
            row: rowNumber,
            errors: [`数据库插入失败: ${error.message}`]
          });
        } finally {
          rowConnection.release();
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
    } finally {
      connection.release();
    }
  });

  return router;
};

// Excel数据验证函数（与前端相同的逻辑）
function validateExcelData(data) {
  const result = {
    isValid: true,
    errors: [],
    data: {}
  };

  const fieldMapping = buildOrderImportFieldMapping();

  const requiredFields = getPreEnrichRequiredOrderImportFields();

  // 将Excel字段名转换为数据库字段名
  for (const [excelField, dbField] of Object.entries(fieldMapping)) {
    if (data[excelField] !== undefined) {
      result.data[dbField] = data[excelField];
    }
  }

  result.errors.push(...validateRequiredFields(result.data, requiredFields, fieldMapping));
  if (result.errors.length > 0) {
    result.isValid = false;
  }

  // 日期字段允许为空，只有有值时才做格式校验
  const normalizedReceiveDate = normalizeOptionalDateValue(result.data.receive_date);
  result.data.receive_date = normalizedReceiveDate;

  if (normalizedReceiveDate) {
    const dateValue = normalizedReceiveDate;

    if (typeof dateValue === "number") {
      // Excel日期序列号转换为JavaScript日期
      const excelDate = new Date((dateValue - 25569) * 86400 * 1000);
      result.data.receive_date = excelDate.toISOString().split("T")[0];
    } else if (typeof dateValue === "string") {
      // 处理字符串日期，支持多种格式
      let parsedDate = null;
      const trimmedValue = dateValue.trim();

      // 优先处理 YYYY/MM/DD 格式（如：2025/10/24）
      const slashMatch = trimmedValue.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (slashMatch) {
        const [, year, month, day] = slashMatch;
        parsedDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        // 尝试 YYYY-MM-DD 格式
        const dashMatch = trimmedValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (dashMatch) {
          const [, year, month, day] = dashMatch;
          parsedDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          // 对于其他格式，使用JavaScript的Date构造函数
          parsedDate = new Date(trimmedValue);
        }
      }

      // 检查解析结果
      if (isNaN(parsedDate.getTime())) {
        result.errors.push(`接收指令日期格式不正确，当前值: "${trimmedValue}"，请使用YYYY/MM/DD、YYYY-MM-DD或MM/DD/YYYY格式`);
        result.isValid = false;
      } else {
        // 使用本地日期，避免UTC转换问题
        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
        const day = String(parsedDate.getDate()).padStart(2, "0");
        result.data.receive_date = `${year}-${month}-${day}`;
      }
    } else {
      result.errors.push("接收指令日期格式不正确，类型不支持");
      result.isValid = false;
    }
  }

  const phoneFields = ["sender_phone", "receiver_phone"];
  for (const field of phoneFields) {
    if (result.data[field]) {
      result.data[field] = normalizeOrderPhoneValue(result.data[field]);
    }
  }

  return result;
}
