const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xls, .xlsx) are allowed"));
    }
  },
});

const DEFAULT_BOX_TYPE_ID = "BOX-DEFAULT";
const DEFAULT_BOX_TYPE = {
  box_type_id: DEFAULT_BOX_TYPE_ID,
  package_type: "默认箱型",
  length_cm: null,
  width_cm: null,
  height_cm: null,
  volume_cm3: null,
};

const PACKAGE_EXCEL_FIELD_MAPPING = {
  "流水号": "serial_number",
  serial_number: "serial_number",
  "品名": "product_name",
  product_name: "product_name",
  "商品编号": "product_code",
  product_code: "product_code",
  "件数": "pieces",
  pieces: "pieces",
  "长": "length",
  "长(cm)": "length",
  length: "length",
  length_cm: "length",
  "宽": "width",
  "宽(cm)": "width",
  width: "width",
  width_cm: "width",
  "高": "height",
  "高(cm)": "height",
  height: "height",
  height_cm: "height",
  "单件重量": "single_weight",
  single_weight: "single_weight",
  "体积": "volume",
  "体积(m³)": "volume",
  "体积(m3)": "volume",
  "体积(cm³)": "volume",
  "体积(cm3)": "volume",
  volume: "volume",
  volume_cm3: "volume",
  "计费重量": "charge_weight",
  charge_weight: "charge_weight",
  "包装种类": "package_type",
  package_type: "package_type",
  "箱型ID": "box_type_id",
  box_type_id: "box_type_id",
  "报关口岸": "customs_port",
  customs_port: "customs_port",
  "报关抬头": "customs_title",
  customs_title: "customs_title",
  "监管条件": "regulatory_conditions",
  regulatory_conditions: "regulatory_conditions",
  "备注1": "remark1",
  remark1: "remark1",
  "备注2": "remark2",
  remark2: "remark2",
};

function toNull(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }
  return value;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseNullableNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : NaN;
}

function roundMetricValue(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function normalizeStoredBoxTypeId(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized === DEFAULT_BOX_TYPE_ID) {
    return null;
  }
  return normalized;
}

function calculateVolumeCm3(length, width, height) {
  if (![length, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }
  return roundMetricValue((length * width * height) / 1000000, 4);
}

function calculateActualWeight(pieces, singleWeight) {
  if (!Number.isFinite(singleWeight)) {
    return null;
  }
  const safePieces = Number.isFinite(pieces) && pieces > 0 ? pieces : 1;
  return roundMetricValue(safePieces * singleWeight, 2);
}

function buildPackageLabel(order) {
  return `包装${order}`;
}

function normalizeBoxTypePayload(payload = {}) {
  const normalized = {
    box_type_id: normalizeText(payload.box_type_id),
    package_type: normalizeText(payload.package_type) || null,
    length_cm: parseNullableNumber(payload.length_cm ?? payload.length),
    width_cm: parseNullableNumber(payload.width_cm ?? payload.width),
    height_cm: parseNullableNumber(payload.height_cm ?? payload.height),
    volume_cm3: parseNullableNumber(payload.volume_cm3 ?? payload.volume),
  };

  if (
    normalized.volume_cm3 === null &&
    Number.isFinite(normalized.length_cm) &&
    Number.isFinite(normalized.width_cm) &&
    Number.isFinite(normalized.height_cm)
  ) {
    normalized.volume_cm3 = calculateVolumeCm3(
      normalized.length_cm,
      normalized.width_cm,
      normalized.height_cm
    );
  } else if (Number.isFinite(normalized.volume_cm3)) {
    normalized.volume_cm3 = roundMetricValue(normalized.volume_cm3, 4);
  }

  return normalized;
}

function validateBoxTypePayload(payload) {
  const errors = [];

  if (!payload.box_type_id) {
    errors.push("箱型ID不能为空");
  }

  ["length_cm", "width_cm", "height_cm", "volume_cm3"].forEach((field) => {
    if (Number.isNaN(payload[field])) {
      const labels = {
        length_cm: "长(cm)",
        width_cm: "宽(cm)",
        height_cm: "高(cm)",
        volume_cm3: "体积(m³)",
      };
      errors.push(`${labels[field]} 必须是有效数字`);
    }
  });

  ["length_cm", "width_cm", "height_cm", "volume_cm3"].forEach((field) => {
    if (Number.isFinite(payload[field]) && payload[field] < 0) {
      const labels = {
        length_cm: "长(cm)",
        width_cm: "宽(cm)",
        height_cm: "高(cm)",
        volume_cm3: "体积(m³)",
      };
      errors.push(`${labels[field]} 不能小于 0`);
    }
  });

  return errors;
}

function normalizePackageRows(rows = [], boxTypeMap = new Map()) {
  return rows.map((row, index) => normalizePackageRow(row, index + 1, boxTypeMap));
}

function normalizePackageRow(row = {}, order = 1, boxTypeMap = new Map()) {
  const requestedBoxTypeId = normalizeStoredBoxTypeId(row.box_type_id);
  const normalized = {
    package_label: normalizeText(row.package_label) || buildPackageLabel(order),
    package_order: Number.parseInt(row.package_order, 10) || order,
    product_name: normalizeText(row.product_name) || null,
    product_code: normalizeText(row.product_code) || null,
    pieces: parseNullableNumber(row.pieces),
    single_weight: parseNullableNumber(row.single_weight),
    length: parseNullableNumber(row.length),
    width: parseNullableNumber(row.width),
    height: parseNullableNumber(row.height),
    volume: parseNullableNumber(row.volume),
    charge_weight: parseNullableNumber(row.charge_weight),
    package_type: normalizeText(row.package_type) || null,
    box_type_id: requestedBoxTypeId,
    customs_port: normalizeText(row.customs_port) || null,
    customs_title: normalizeText(row.customs_title) || null,
    regulatory_conditions: normalizeText(row.regulatory_conditions) || null,
    remark1: normalizeText(row.remark1) || null,
    remark2: normalizeText(row.remark2) || null,
  };

  if (requestedBoxTypeId && boxTypeMap.has(requestedBoxTypeId)) {
    applyBoxTypeToPackageRow(normalized, boxTypeMap);
  }
  applyPackageVolumeFallback(normalized);
  normalized.box_type_id = resolvePackageBoxTypeId(normalized, requestedBoxTypeId, boxTypeMap);

  return normalized;
}

function applyPackageVolumeFallback(item) {
  if (Number.isNaN(item.length)) item.length = null;
  if (Number.isNaN(item.width)) item.width = null;
  if (Number.isNaN(item.height)) item.height = null;
  if (Number.isNaN(item.single_weight)) item.single_weight = null;
  if (Number.isNaN(item.volume)) item.volume = null;
  if (Number.isNaN(item.pieces)) item.pieces = null;
  if (Number.isNaN(item.charge_weight)) item.charge_weight = null;

  if (
    Number.isFinite(item.length) &&
    Number.isFinite(item.width) &&
    Number.isFinite(item.height)
  ) {
    item.volume = calculateVolumeCm3(item.length, item.width, item.height);
  } else if (Number.isFinite(item.volume)) {
    item.volume = roundMetricValue(item.volume, 4);
  }

  if (Number.isFinite(item.single_weight)) {
    item.single_weight = roundMetricValue(item.single_weight, 2);
  }

  if (Number.isFinite(item.charge_weight)) {
    item.charge_weight = roundMetricValue(item.charge_weight, 2);
  }
}

function applyBoxTypeToPackageRow(item, boxTypeMap) {
  if (!item.box_type_id) {
    return item;
  }

  const boxType = boxTypeMap.get(item.box_type_id);
  if (!boxType) {
    return item;
  }

  item.package_type = item.package_type || boxType.package_type || null;
  item.length = Number.isFinite(item.length) ? item.length : boxType.length_cm;
  item.width = Number.isFinite(item.width) ? item.width : boxType.width_cm;
  item.height = Number.isFinite(item.height) ? item.height : boxType.height_cm;
  if (!Number.isFinite(item.volume) && Number.isFinite(boxType.volume_cm3)) {
    item.volume = roundMetricValue(boxType.volume_cm3, 4);
  }
  return item;
}

function isSameMetricValue(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Number(left) === Number(right);
}

function isSelectableBoxType(boxType) {
  return !!boxType && normalizeStoredBoxTypeId(boxType.box_type_id) !== null;
}

function doesPackageRowMatchBoxType(item, boxType) {
  if (!isSelectableBoxType(boxType)) {
    return false;
  }

  const packageType = normalizeText(item.package_type);
  if (
    !packageType ||
    !Number.isFinite(item.length) ||
    !Number.isFinite(item.width) ||
    !Number.isFinite(item.height)
  ) {
    return false;
  }

  return (
    normalizeText(boxType.package_type) === packageType &&
    isSameMetricValue(boxType.length_cm, item.length) &&
    isSameMetricValue(boxType.width_cm, item.width) &&
    isSameMetricValue(boxType.height_cm, item.height)
  );
}

function findMatchingBoxTypes(item, boxTypeMap) {
  return [...boxTypeMap.values()].filter((boxType) => doesPackageRowMatchBoxType(item, boxType));
}

function resolvePackageBoxTypeId(item, requestedBoxTypeId, boxTypeMap) {
  const normalizedRequestedId = normalizeStoredBoxTypeId(requestedBoxTypeId);
  if (normalizedRequestedId) {
    const requestedBoxType = boxTypeMap.get(normalizedRequestedId);
    if (doesPackageRowMatchBoxType(item, requestedBoxType)) {
      return normalizedRequestedId;
    }
  }

  const matches = findMatchingBoxTypes(item, boxTypeMap);
  return matches.length === 1 ? matches[0].box_type_id : null;
}

async function fetchBoxTypes(db) {
  const [rows] = await db.execute(
    "SELECT id, box_type_id, package_type, length_cm, width_cm, height_cm, volume_cm3, created_at, updated_at FROM package_box_types ORDER BY box_type_id ASC"
  );
  return rows;
}

async function fetchBoxTypeMap(db) {
  const rows = await fetchBoxTypes(db);
  return new Map(rows.map((row) => [row.box_type_id, row]));
}

let packageSchemaReadyPromise = null;

async function ensurePackageSchema(db) {
  if (!packageSchemaReadyPromise) {
    packageSchemaReadyPromise = (async () => {
      const connection = await db.getConnection();
      try {
        const [tableCheck] = await connection.execute("SHOW TABLES LIKE 'package'");
        if (tableCheck.length === 0) {
          return;
        }

        const packageColumns = [
          { name: "package_label", sql: "ALTER TABLE `package` ADD COLUMN package_label VARCHAR(50) DEFAULT NULL COMMENT '包装标签' AFTER serial_number" },
          { name: "package_order", sql: "ALTER TABLE `package` ADD COLUMN package_order INT DEFAULT 1 COMMENT '包装排序' AFTER package_label" },
          { name: "box_type_id", sql: "ALTER TABLE `package` ADD COLUMN box_type_id VARCHAR(64) DEFAULT NULL COMMENT '箱型ID' AFTER package_order" },
          { name: "single_weight", sql: "ALTER TABLE `package` ADD COLUMN single_weight DOUBLE DEFAULT NULL COMMENT '单件重量' AFTER pieces" },
          { name: "remark1", sql: "ALTER TABLE `package` ADD COLUMN remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1'" },
          { name: "remark2", sql: "ALTER TABLE `package` ADD COLUMN remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2'" },
        ];

        for (const column of packageColumns) {
          const [rows] = await connection.execute(`SHOW COLUMNS FROM \`package\` LIKE '${column.name}'`);
          if (rows.length === 0) {
            await connection.execute(column.sql);
          }
        }

        const [uniqueIndex] = await connection.execute("SHOW INDEX FROM `package` WHERE Key_name = 'unique_serial_number'");
        if (uniqueIndex.length > 0) {
          await connection.execute("ALTER TABLE `package` DROP INDEX unique_serial_number");
        }

        const [compoundIndex] = await connection.execute("SHOW INDEX FROM `package` WHERE Key_name = 'idx_serial_package_order'");
        if (compoundIndex.length === 0) {
          await connection.execute("ALTER TABLE `package` ADD INDEX idx_serial_package_order (serial_number, package_order)");
        }

        await connection.execute(`
          CREATE TABLE IF NOT EXISTS package_box_types (
            id INT AUTO_INCREMENT PRIMARY KEY,
            box_type_id VARCHAR(64) NOT NULL,
            package_type VARCHAR(100) DEFAULT NULL,
            length_cm DECIMAL(12, 2) DEFAULT NULL,
            width_cm DECIMAL(12, 2) DEFAULT NULL,
            height_cm DECIMAL(12, 2) DEFAULT NULL,
            volume_cm3 DECIMAL(16, 4) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_box_type_id (box_type_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.execute(
          `INSERT INTO package_box_types (box_type_id, package_type, length_cm, width_cm, height_cm, volume_cm3)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             package_type = VALUES(package_type),
             length_cm = COALESCE(package_box_types.length_cm, VALUES(length_cm)),
             width_cm = COALESCE(package_box_types.width_cm, VALUES(width_cm)),
             height_cm = COALESCE(package_box_types.height_cm, VALUES(height_cm)),
             volume_cm3 = COALESCE(package_box_types.volume_cm3, VALUES(volume_cm3))`,
          [
            DEFAULT_BOX_TYPE.box_type_id,
            DEFAULT_BOX_TYPE.package_type,
            DEFAULT_BOX_TYPE.length_cm,
            DEFAULT_BOX_TYPE.width_cm,
            DEFAULT_BOX_TYPE.height_cm,
            DEFAULT_BOX_TYPE.volume_cm3,
          ]
        );

        await connection.execute("UPDATE `package` SET package_order = 1 WHERE package_order IS NULL OR package_order <= 0");
        await connection.execute("UPDATE `package` SET package_label = CONCAT('包装', package_order) WHERE package_label IS NULL OR package_label = ''");

        const [boxTypeRows] = await connection.execute(
          "SELECT box_type_id, package_type FROM package_box_types"
        );
        const existingBoxTypeIds = new Set(boxTypeRows.map((row) => row.box_type_id));
        const packageTypeToBoxTypeId = new Map(
          boxTypeRows
            .filter((row) => row.package_type)
            .map((row) => [row.package_type, row.box_type_id])
        );

        const [legacyTypes] = await connection.execute(
          "SELECT DISTINCT package_type FROM `package` WHERE package_type IS NOT NULL AND TRIM(package_type) <> ''"
        );

        for (const row of legacyTypes) {
          const packageType = normalizeText(row.package_type);
          if (!packageType || packageTypeToBoxTypeId.has(packageType)) {
            continue;
          }

          const sanitized = packageType
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "BOX";
          let boxTypeId = sanitized;
          let suffix = 1;
          while (existingBoxTypeIds.has(boxTypeId)) {
            suffix += 1;
            boxTypeId = `${sanitized}-${suffix}`;
          }

          await connection.execute(
            `INSERT INTO package_box_types (box_type_id, package_type, length_cm, width_cm, height_cm, volume_cm3)
             SELECT ?, ?, NULLIF(length, 0), NULLIF(width, 0), NULLIF(height, 0), NULLIF(volume, 0)
             FROM \`package\`
             WHERE package_type = ?
             ORDER BY id ASC
             LIMIT 1`,
            [boxTypeId, packageType, packageType]
          );
          existingBoxTypeIds.add(boxTypeId);
          packageTypeToBoxTypeId.set(packageType, boxTypeId);
        }
      } finally {
        connection.release();
      }
    })().catch((error) => {
      packageSchemaReadyPromise = null;
      throw error;
    });
  }

  return packageSchemaReadyPromise;
}

function buildPackageResponseRows(rows = [], boxTypeMap = new Map()) {
  return rows.map((row) => {
    const normalized = normalizePackageRow(row, row.package_order || 1, boxTypeMap);
    return {
      ...row,
      package_label: normalized.package_label,
      package_order: normalized.package_order,
      box_type_id: normalized.box_type_id,
      package_type: normalized.package_type,
      single_weight: normalized.single_weight,
      length: normalized.length,
      width: normalized.width,
      height: normalized.height,
      volume: normalized.volume,
      charge_weight: normalized.charge_weight,
      actual_weight: calculateActualWeight(normalized.pieces, normalized.single_weight),
    };
  });
}

function validatePackageExcelData(data, boxTypeMap = new Map()) {
  const result = {
    isValid: true,
    errors: [],
    data: {},
  };

  const requiredFields = ["serial_number"];

  for (const [excelField, dbField] of Object.entries(PACKAGE_EXCEL_FIELD_MAPPING)) {
    if (data[excelField] !== undefined && data[excelField] !== null && data[excelField] !== "") {
      result.data[dbField] = data[excelField];
    }
  }

  requiredFields.forEach((field) => {
    if (!result.data[field] || normalizeText(result.data[field]) === "") {
      const excelFieldName = Object.keys(PACKAGE_EXCEL_FIELD_MAPPING).find(
        (key) => PACKAGE_EXCEL_FIELD_MAPPING[key] === field
      ) || field;
      result.errors.push(`"${excelFieldName}" 字段为空，请检查 Excel 文件`);
    }
  });

  const numericFields = ["pieces", "single_weight", "length", "width", "height", "volume", "charge_weight"];
  numericFields.forEach((field) => {
    if (result.data[field] !== undefined) {
      const numericValue = parseNullableNumber(result.data[field]);
      if (Number.isNaN(numericValue)) {
        const excelFieldName = Object.keys(PACKAGE_EXCEL_FIELD_MAPPING).find(
          (key) => PACKAGE_EXCEL_FIELD_MAPPING[key] === field
        ) || field;
        result.errors.push(`"${excelFieldName}" 必须是有效的数字`);
      } else {
        result.data[field] = numericValue;
      }
    }
  });

  if (result.data.box_type_id !== undefined) {
    result.data.box_type_id = normalizeStoredBoxTypeId(result.data.box_type_id);
    if (result.data.box_type_id && !boxTypeMap.has(result.data.box_type_id)) {
      result.errors.push(`箱型ID "${result.data.box_type_id}" 不存在于包装信息库中`);
    }
  }

  result.data.serial_number = normalizeText(result.data.serial_number);
  result.data.package_type = normalizeText(result.data.package_type) || null;
  result.data.product_name = normalizeText(result.data.product_name) || null;
  result.data.product_code = normalizeText(result.data.product_code) || null;
  result.data.customs_port = normalizeText(result.data.customs_port) || null;
  result.data.customs_title = normalizeText(result.data.customs_title) || null;
  result.data.regulatory_conditions = normalizeText(result.data.regulatory_conditions) || null;
  result.data.remark1 = normalizeText(result.data.remark1) || null;
  result.data.remark2 = normalizeText(result.data.remark2) || null;

  const normalizedPackage = normalizePackageRow(result.data, 1, boxTypeMap);
  result.data = {
    ...result.data,
    ...normalizedPackage,
  };

  if (
    result.data.box_type_id &&
    boxTypeMap.has(result.data.box_type_id) &&
    !result.data.package_type
  ) {
    result.data.package_type = boxTypeMap.get(result.data.box_type_id).package_type || null;
  }

  if (result.errors.length > 0) {
    result.isValid = false;
  }

  return result;
}

const createPackagesRouter = (db) => {
  router.get("/box-types", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const boxTypes = await fetchBoxTypes(db);
      res.json({ boxTypes });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/box-types/:id", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const [rows] = await db.execute(
        "SELECT * FROM package_box_types WHERE id = ?",
        [req.params.id]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Box type not found" });
      }
      return res.json({ boxType: rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post("/box-types", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const payload = normalizeBoxTypePayload(req.body);
      const errors = validateBoxTypePayload(payload);
      if (errors.length > 0) {
        return res.status(400).json({ error: errors[0], errors });
      }

      const [result] = await db.execute(
        `INSERT INTO package_box_types (box_type_id, package_type, length_cm, width_cm, height_cm, volume_cm3)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          payload.box_type_id,
          toNull(payload.package_type),
          toNull(payload.length_cm),
          toNull(payload.width_cm),
          toNull(payload.height_cm),
          toNull(payload.volume_cm3),
        ]
      );

      const [rows] = await db.execute("SELECT * FROM package_box_types WHERE id = ?", [result.insertId]);
      return res.status(201).json({ boxType: rows[0] });
    } catch (error) {
      const isDuplicate = error.code === "ER_DUP_ENTRY";
      return res.status(isDuplicate ? 400 : 500).json({
        error: isDuplicate ? "箱型ID已存在" : error.message,
      });
    }
  });

  router.put("/box-types/:id", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const payload = normalizeBoxTypePayload(req.body);
      const errors = validateBoxTypePayload(payload);
      if (errors.length > 0) {
        return res.status(400).json({ error: errors[0], errors });
      }

      const [currentRows] = await db.execute(
        "SELECT * FROM package_box_types WHERE id = ?",
        [req.params.id]
      );
      if (!currentRows.length) {
        return res.status(404).json({ error: "Box type not found" });
      }
      const current = currentRows[0];

      await db.execute(
        `UPDATE package_box_types
         SET box_type_id = ?, package_type = ?, length_cm = ?, width_cm = ?, height_cm = ?, volume_cm3 = ?
         WHERE id = ?`,
        [
          payload.box_type_id,
          toNull(payload.package_type),
          toNull(payload.length_cm),
          toNull(payload.width_cm),
          toNull(payload.height_cm),
          toNull(payload.volume_cm3),
          req.params.id,
        ]
      );

      if (current.box_type_id !== payload.box_type_id) {
        await db.execute(
          "UPDATE `package` SET box_type_id = ? WHERE box_type_id = ?",
          [payload.box_type_id, current.box_type_id]
        );
      }

      const [rows] = await db.execute("SELECT * FROM package_box_types WHERE id = ?", [req.params.id]);
      return res.json({ boxType: rows[0] });
    } catch (error) {
      const isDuplicate = error.code === "ER_DUP_ENTRY";
      return res.status(isDuplicate ? 400 : 500).json({
        error: isDuplicate ? "箱型ID已存在" : error.message,
      });
    }
  });

  router.delete("/box-types/:id", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const [currentRows] = await db.execute(
        "SELECT * FROM package_box_types WHERE id = ?",
        [req.params.id]
      );
      if (!currentRows.length) {
        return res.status(404).json({ error: "Box type not found" });
      }

      const current = currentRows[0];
      if (current.box_type_id === DEFAULT_BOX_TYPE_ID) {
        return res.status(400).json({ error: "默认箱型不能删除" });
      }

      await db.execute(
        "UPDATE `package` SET box_type_id = NULL WHERE box_type_id = ?",
        [current.box_type_id]
      );
      await db.execute("DELETE FROM package_box_types WHERE id = ?", [req.params.id]);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get("/import-template", async (req, res) => {
    try {
      const workbook = XLSX.utils.book_new();
      const headers = [[
        "流水号",
        "箱型ID",
        "包装类型",
        "件数",
        "单件重量",
        "长(cm)",
        "宽(cm)",
        "高(cm)",
        "体积(m³)",
        "计费重量",
        "品名",
        "商品编号",
        "报关口岸",
        "报关抬头",
        "监管条件",
        "备注1",
        "备注2",
      ]];
      const templateSheet = XLSX.utils.aoa_to_sheet(headers);
      XLSX.utils.book_append_sheet(workbook, templateSheet, "包装导入模板");

      const noteRows = [
        ["字段", "说明"],
        ["流水号", "必填，按流水号批量更新当前包装记录"],
        ["箱型ID", "选填，填写后会联动回填包装类型、长、宽、高；不存在时按行报错"],
        ["包装类型", "兼容旧模板；未填写时会优先从箱型ID回填"],
        ["长(cm)", "尺寸单位统一为 cm"],
        ["宽(cm)", "尺寸单位统一为 cm"],
        ["高(cm)", "尺寸单位统一为 cm"],
        ["单件重量", "单件重量将按 件数×单件重量 参与实重汇总"],
        ["体积(m³)", "体积按 长×宽×高 / 1000000 自动计算"],
      ];
      const noteSheet = XLSX.utils.aoa_to_sheet(noteRows);
      XLSX.utils.book_append_sheet(workbook, noteSheet, "填写说明");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=\"package_import_template.xlsx\"");
      return res.send(buffer);
    } catch (error) {
      return res.status(500).json({ error: "Failed to generate import template: " + error.message });
    }
  });

  router.get("/", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const boxTypeMap = await fetchBoxTypeMap(db);
      const [rows] = await db.execute(`
        SELECT
          p.*,
          o.company_name,
          o.orderer,
          o.business_type,
          o.sender_id,
          o.customer_id,
          o.receive_date,
          o.origin,
          o.destination,
          o.trade_term,
          o.product_name AS order_product_name,
          COALESCE(pt.transport_mode, t.transport_mode) AS transport_mode,
          t.tracking_number AS tracking_number
        FROM \`package\` p
        LEFT JOIN orders o ON p.serial_number = o.serial_number
        LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = p.serial_number
        LEFT JOIN transfer t ON t.serial_number = p.serial_number
        ORDER BY p.updated_at DESC, COALESCE(p.package_order, 1) ASC, p.id ASC
      `);
      res.json({ packages: buildPackageResponseRows(rows, boxTypeMap) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const boxTypeMap = await fetchBoxTypeMap(db);
      const [rows] = await db.execute(`
        SELECT
          p.*,
          o.company_name,
          o.orderer,
          o.business_type,
          o.sender_id,
          o.customer_id,
          o.receive_date,
          o.origin,
          o.destination,
          o.trade_term,
          o.product_name AS order_product_name,
          COALESCE(pt.transport_mode, t.transport_mode) AS transport_mode,
          t.tracking_number AS tracking_number
        FROM \`package\` p
        LEFT JOIN orders o ON p.serial_number = o.serial_number
        LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = p.serial_number
        LEFT JOIN transfer t ON t.serial_number = p.serial_number
        WHERE p.id = ?
      `, [req.params.id]);
      if (!rows.length) {
        return res.status(404).json({ error: "Package not found" });
      }
      const normalizedRows = buildPackageResponseRows(rows, boxTypeMap);
      return res.json({ package: normalizedRows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get("/serial/:serial_number", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const boxTypeMap = await fetchBoxTypeMap(db);
      const [rows] = await db.execute(`
        SELECT
          p.*,
          o.company_name,
          o.orderer,
          o.business_type,
          o.sender_id,
          o.customer_id,
          o.receive_date,
          o.origin,
          o.destination,
          o.trade_term,
          o.product_name AS order_product_name,
          COALESCE(pt.transport_mode, t.transport_mode) AS transport_mode,
          t.tracking_number AS tracking_number
        FROM \`package\` p
        LEFT JOIN orders o ON p.serial_number = o.serial_number
        LEFT JOIN pickup_transport_tracking pt ON pt.serial_number = p.serial_number
        LEFT JOIN transfer t ON t.serial_number = p.serial_number
        WHERE p.serial_number = ?
        ORDER BY COALESCE(p.package_order, 1) ASC, p.id ASC
      `, [req.params.serial_number]);
      if (!rows.length) {
        return res.status(404).json({ error: "Package not found" });
      }
      const normalizedRows = buildPackageResponseRows(rows, boxTypeMap);
      return res.json({ package: normalizedRows[0], packages: normalizedRows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      await ensurePackageSchema(db);
      const boxTypeMap = await fetchBoxTypeMap(db);
      const normalized = normalizePackageRow(req.body, Number.parseInt(req.body.package_order, 10) || 1, boxTypeMap);
      const [result] = await db.execute(
        `UPDATE \`package\`
         SET package_label = ?, package_order = ?, box_type_id = ?, product_name = ?, product_code = ?, pieces = ?, single_weight = ?, length = ?, width = ?, height = ?, volume = ?, charge_weight = ?, package_type = ?, customs_port = ?, customs_title = ?, regulatory_conditions = ?, remark1 = ?, remark2 = ?
         WHERE id = ?`,
        [
          toNull(normalized.package_label),
          toNull(normalized.package_order),
          toNull(normalized.box_type_id),
          toNull(normalized.product_name),
          toNull(normalized.product_code),
          toNull(normalized.pieces),
          toNull(normalized.single_weight),
          toNull(normalized.length),
          toNull(normalized.width),
          toNull(normalized.height),
          toNull(normalized.volume),
          toNull(normalized.charge_weight),
          toNull(normalized.package_type),
          toNull(normalized.customs_port),
          toNull(normalized.customs_title),
          toNull(normalized.regulatory_conditions),
          toNull(normalized.remark1),
          toNull(normalized.remark2),
          req.params.id,
        ]
      );
      if (!result.affectedRows) {
        return res.status(404).json({ error: "Package not found" });
      }
      return res.json({ message: "Package updated successfully" });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.put("/serial/:serial_number", async (req, res) => {
    let connection;
    try {
      await ensurePackageSchema(db);
      const serialNumber = req.params.serial_number;
      if (!serialNumber || serialNumber === "undefined") {
        return res.status(400).json({ error: "serial_number is required" });
      }

      const boxTypeMap = await fetchBoxTypeMap(db);
      const sourceItems = Array.isArray(req.body.package_items) && req.body.package_items.length > 0
        ? req.body.package_items
        : [req.body];
      const packageItems = normalizePackageRows(sourceItems, boxTypeMap);

      connection = await db.getConnection();
      await connection.beginTransaction();

      const [existingRows] = await connection.execute("SELECT id FROM `package` WHERE serial_number = ?", [serialNumber]);
      if (existingRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "Package not found" });
      }

      await connection.execute("DELETE FROM `package` WHERE serial_number = ?", [serialNumber]);

      const insertSql = `
        INSERT INTO \`package\` (
          serial_number,
          package_label,
          package_order,
          box_type_id,
          product_name,
          product_code,
          pieces,
          single_weight,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      for (const item of packageItems) {
        await connection.execute(insertSql, [
          serialNumber,
          item.package_label,
          item.package_order,
          toNull(item.box_type_id),
          toNull(item.product_name),
          toNull(item.product_code),
          toNull(item.pieces),
          toNull(item.single_weight),
          toNull(item.length),
          toNull(item.width),
          toNull(item.height),
          toNull(item.volume),
          toNull(item.charge_weight),
          toNull(item.package_type),
          toNull(item.customs_port),
          toNull(item.customs_title),
          toNull(item.regulatory_conditions),
          toNull(item.remark1),
          toNull(item.remark2),
        ]);
      }

      await connection.commit();
      return res.json({ message: "Package updated successfully" });
    } catch (err) {
      if (connection) {
        await connection.rollback();
      }
      return res.status(500).json({ error: err.message });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  });

  router.post("/parse-excel", upload.single("excelFile"), async (req, res) => {
    try {
      await ensurePackageSchema(db);
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        return res.status(400).json({ error: "Excel file is empty" });
      }

      const boxTypeMap = await fetchBoxTypeMap(db);
      const validationResult = validatePackageExcelData(jsonData[0], boxTypeMap);

      if (!validationResult.isValid) {
        return res.status(400).json({
          error: "数据验证失败",
          details: validationResult.errors,
        });
      }

      return res.json({
        success: true,
        message: "Excel 数据解析成功",
        data: validationResult.data,
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to parse Excel file: " + error.message });
    }
  });

  router.post("/import-excel", upload.single("excelFile"), async (req, res) => {
    try {
      await ensurePackageSchema(db);
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        return res.status(400).json({ error: "Excel file is empty" });
      }

      const boxTypeMap = await fetchBoxTypeMap(db);
      const results = {
        total: jsonData.length,
        success: 0,
        failed: 0,
        errors: [],
        successfulImports: [],
      };

      for (let i = 0; i < jsonData.length; i += 1) {
        const rowNumber = i + 2;
        try {
          const validationResult = validatePackageExcelData(jsonData[i], boxTypeMap);
          if (!validationResult.isValid) {
            results.failed += 1;
            results.errors.push({ row: rowNumber, errors: validationResult.errors });
            continue;
          }

          const {
            serial_number,
            product_name,
            product_code,
            pieces,
            single_weight,
            length,
            width,
            height,
            volume,
            charge_weight,
            package_type,
            box_type_id,
            customs_port,
            customs_title,
            regulatory_conditions,
            remark1,
            remark2,
          } = validationResult.data;

          const [updateResult] = await db.execute(
            `UPDATE \`package\`
             SET product_name = ?, product_code = ?, pieces = ?, single_weight = ?, length = ?, width = ?, height = ?, volume = ?, charge_weight = ?, package_type = ?, box_type_id = ?, customs_port = ?, customs_title = ?, regulatory_conditions = ?, remark1 = ?, remark2 = ?
             WHERE serial_number = ?`,
            [
              toNull(product_name),
              toNull(product_code),
              toNull(pieces),
              toNull(single_weight),
              toNull(length),
              toNull(width),
              toNull(height),
              toNull(volume),
              toNull(charge_weight),
              toNull(package_type),
              toNull(box_type_id),
              toNull(customs_port),
              toNull(customs_title),
              toNull(regulatory_conditions),
              toNull(remark1),
              toNull(remark2),
              toNull(serial_number),
            ]
          );

          if (updateResult.affectedRows > 0) {
            results.success += 1;
            results.successfulImports.push({
              serial_number,
              row: rowNumber,
            });
          } else {
            results.failed += 1;
            results.errors.push({
              row: rowNumber,
              errors: [`流水号 ${serial_number} 不存在于包装信息表中`],
            });
          }
        } catch (error) {
          results.failed += 1;
          results.errors.push({
            row: rowNumber,
            errors: [`数据库更新失败: ${error.message}`],
          });
        }
      }

      return res.json({
        success: results.failed === 0,
        message: `导入完成：共 ${results.total} 行，成功 ${results.success} 行，失败 ${results.failed} 行`,
        results,
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to import Excel file: " + error.message });
    }
  });

  return router;
};

module.exports = createPackagesRouter;
module.exports._test = {
  DEFAULT_BOX_TYPE_ID,
  normalizeStoredBoxTypeId,
  doesPackageRowMatchBoxType,
  findMatchingBoxTypes,
  resolvePackageBoxTypeId,
  normalizePackageRow,
  validatePackageExcelData,
};
