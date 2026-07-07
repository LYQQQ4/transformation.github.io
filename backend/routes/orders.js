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
  // GET all orders
  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM orders ORDER BY serial_number DESC");
      res.json({ orders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single order by serial_number
  router.get("/serial/:serial_number", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM orders WHERE serial_number = ?", [req.params.serial_number]);
      if (rows.length === 0) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      res.json({ order: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single order by id
  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM orders WHERE id = ?", [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      res.json({ order: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create new order
  router.post("/", async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const company_name = req.body.company_name;
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
          const [result] = await connection.execute(sql, [company_name, orderer, receive_date, business_type, customer_id, sender_id || null, shipping_address, sender_name, sender_phone, delivery_address, receiver_name, receiver_phone, origin, destination, trade_term || null, product_name || null, remark1 || null, remark2 || null, serialNumber]);

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
      const company_name = req.body.company_name;
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

      const sql = "UPDATE orders SET company_name = ?, orderer = ?, receive_date = ?, business_type = ?, customer_id = ?, sender_id = ?, shipping_address = ?, sender_name = ?, sender_phone = ?, delivery_address = ?, receiver_name = ?, receiver_phone = ?, origin = ?, destination = ?, trade_term = ?, product_name = ?, remark1 = ?, remark2 = ? WHERE id = ?";
      const [result] = await db.execute(sql, [company_name, orderer, receive_date, business_type, customer_id, sender_id || null, shipping_address, sender_name, sender_phone, delivery_address, receiver_name, receiver_phone, origin, destination, trade_term || null, product_name || null, remark1 || null, remark2 || null, req.params.id]);
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
  router.delete("/:id", async (req, res) => {
    const connection = await db.getConnection();
    try {
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

      // 最后删除订单信息（orders表）
      const [result] = await connection.execute("DELETE FROM orders WHERE id = ?", [req.params.id]);

      await connection.commit();
      res.json({ message: "Order and related package and transfer information deleted successfully" });
    } catch (err) {
      await connection.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
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
      const validationResult = validateExcelData(excelData);

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
    const connection = await db.getConnection();
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
            continue;
          }

          // 插入数据库
          const { company_name, orderer, receive_date, business_type, customer_id, sender_id, shipping_address, sender_name, sender_phone, delivery_address, receiver_name, receiver_phone, origin, destination, trade_term, product_name, remark1, remark2 } = validationResult.data;

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
              const [insertResult] = await rowConnection.execute(sql, [company_name, orderer, receive_date, business_type, customer_id, sender_id || null, shipping_address, sender_name, sender_phone, delivery_address, receiver_name, receiver_phone, origin, destination, trade_term || null, product_name || null, remark1 || null, remark2 || null, serialNumber]);

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

  // 定义字段映射
  const fieldMapping = {
    "公司抬头": "company_name",
    "公司名称": "company_name",
    "指令人": "orderer",
    "接收指令日期": "receive_date",
    "接收日期": "receive_date",
    "指令日期": "receive_date",
    "日期": "receive_date",
    "业务类型": "business_type",
    "客户ID": "customer_id",
    "发件人ID": "sender_id",
    "发货地址": "shipping_address",
    "发件人": "sender_name",
    "发件人电话": "sender_phone",
    "收货地址": "delivery_address",
    "收件人": "receiver_name",
    "收件人电话": "receiver_phone",
    "始发地": "origin",
    "目的地": "destination",
    "贸易术语": "trade_term",
    "货物品名": "product_name",
    "品名": "product_name",
    "备注1": "remark1",
    "备注2": "remark2"
  };

  // 检查必需字段
  const requiredFields = [
    "company_name", "orderer", "receive_date", "business_type",
    "customer_id", "shipping_address", "sender_name", "sender_phone",
    "delivery_address", "receiver_name", "receiver_phone", "origin", "destination"
  ];

  // 将Excel字段名转换为数据库字段名
  for (const [excelField, dbField] of Object.entries(fieldMapping)) {
    if (data[excelField] !== undefined) {
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

  // 验证日期格式
  if (result.data.receive_date) {
    const dateValue = result.data.receive_date;

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

  // 验证电话号码格式
  const phoneFields = ["sender_phone", "receiver_phone"];
  for (const field of phoneFields) {
    if (result.data[field]) {
      const phone = result.data[field].toString();
      if (!/^[\d\-\+\(\)\s]{7,20}$/.test(phone)) {
        const excelFieldName = Object.keys(fieldMapping).find(key => fieldMapping[key] === field);
        result.errors.push(`"${excelFieldName}" 格式不正确，请检查电话号码`);
        result.isValid = false;
      }
    }
  }

  return result;
}
