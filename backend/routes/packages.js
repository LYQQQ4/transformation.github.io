const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("只允许上传 Excel 文件（.xls 或 .xlsx）"));
        }
    }
});

function toNull(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === "string" && value.trim() === "") {
        return null;
    }
    return value;
}

function buildPackageLabel(order) {
    return `包装${order}`;
}

function normalizePackageItemsPayload(body) {
    const sourceItems = Array.isArray(body.package_items) && body.package_items.length > 0
        ? body.package_items
        : [body];

    return sourceItems.map((item, index) => {
        const packageOrder = Number.parseInt(item.package_order, 10) || index + 1;
        return {
            package_label: toNull(item.package_label) || buildPackageLabel(packageOrder),
            package_order: packageOrder,
            product_name: toNull(item.product_name),
            product_code: toNull(item.product_code),
            pieces: toNull(item.pieces),
            length: toNull(item.length),
            width: toNull(item.width),
            height: toNull(item.height),
            volume: toNull(item.volume),
            charge_weight: toNull(item.charge_weight),
            package_type: toNull(item.package_type),
            customs_port: toNull(item.customs_port),
            customs_title: toNull(item.customs_title),
            regulatory_conditions: toNull(item.regulatory_conditions),
            remark1: toNull(item.remark1),
            remark2: toNull(item.remark2)
        };
    });
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

                const [labelColumn] = await connection.execute("SHOW COLUMNS FROM `package` LIKE 'package_label'");
                if (labelColumn.length === 0) {
                    await connection.execute("ALTER TABLE `package` ADD COLUMN package_label VARCHAR(50) DEFAULT NULL COMMENT '包装标签' AFTER serial_number");
                }

                const [orderColumn] = await connection.execute("SHOW COLUMNS FROM `package` LIKE 'package_order'");
                if (orderColumn.length === 0) {
                    await connection.execute("ALTER TABLE `package` ADD COLUMN package_order INT DEFAULT 1 COMMENT '包装排序' AFTER package_label");
                }

                const [uniqueIndex] = await connection.execute("SHOW INDEX FROM `package` WHERE Key_name = 'unique_serial_number'");
                if (uniqueIndex.length > 0) {
                    await connection.execute("ALTER TABLE `package` DROP INDEX unique_serial_number");
                }

                const [compoundIndex] = await connection.execute("SHOW INDEX FROM `package` WHERE Key_name = 'idx_serial_package_order'");
                if (compoundIndex.length === 0) {
                    await connection.execute("ALTER TABLE `package` ADD INDEX idx_serial_package_order (serial_number, package_order)");
                }

                await connection.execute("UPDATE `package` SET package_order = 1 WHERE package_order IS NULL OR package_order <= 0");
                await connection.execute("UPDATE `package` SET package_label = CONCAT('包装', package_order) WHERE package_label IS NULL OR package_label = ''");
            } finally {
                connection.release();
            }
        })().catch(error => {
            packageSchemaReadyPromise = null;
            throw error;
        });
    }

    return packageSchemaReadyPromise;
}

module.exports = (db) => {
    router.get("/", async (req, res) => {
        try {
            await ensurePackageSchema(db);
            const [tableCheck] = await db.execute("SHOW TABLES LIKE 'package'");
            if (tableCheck.length === 0) {
                return res.status(500).json({ error: "Package table does not exist" });
            }

            const [rows] = await db.execute(`
                SELECT p.*, o.company_name, o.orderer, o.business_type, o.customer_id
                FROM \`package\` p
                LEFT JOIN orders o ON p.serial_number = o.serial_number
                ORDER BY p.updated_at DESC, COALESCE(p.package_order, 1) ASC, p.id ASC
                LIMIT 200
            `);
            res.json({ packages: rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/:id", async (req, res) => {
        try {
            await ensurePackageSchema(db);
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

    router.get("/serial/:serial_number", async (req, res) => {
        try {
            await ensurePackageSchema(db);
            const [rows] = await db.execute(`
                SELECT p.*, o.company_name, o.orderer, o.business_type, o.customer_id
                FROM \`package\` p
                LEFT JOIN orders o ON p.serial_number = o.serial_number
                WHERE p.serial_number = ?
                ORDER BY COALESCE(p.package_order, 1) ASC, p.id ASC
            `, [req.params.serial_number]);
            if (rows.length === 0) {
                res.status(404).json({ error: "Package not found" });
                return;
            }
            res.json({ package: rows[0], packages: rows });
        } catch (err) {
            try {
                await ensurePackageSchema(db);
                const [rows] = await db.execute(
                    "SELECT * FROM `package` WHERE serial_number = ? ORDER BY COALESCE(package_order, 1) ASC, id ASC",
                    [req.params.serial_number]
                );
                if (rows.length === 0) {
                    res.status(404).json({ error: "Package not found" });
                    return;
                }
                res.json({ package: rows[0], packages: rows });
            } catch (innerErr) {
                res.status(500).json({ error: innerErr.message });
            }
        }
    });

    router.put("/:id", async (req, res) => {
        try {
            await ensurePackageSchema(db);
            const {
                package_label,
                package_order,
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

            const sql = "UPDATE `package` SET package_label = ?, package_order = ?, product_name = ?, product_code = ?, pieces = ?, length = ?, width = ?, height = ?, volume = ?, charge_weight = ?, package_type = ?, customs_port = ?, customs_title = ?, regulatory_conditions = ?, remark1 = ?, remark2 = ? WHERE id = ?";
            const [result] = await db.execute(sql, [
                toNull(package_label),
                toNull(package_order),
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
                req.params.id
            ]);
            if (result.affectedRows === 0) {
                res.status(404).json({ error: "Package not found" });
                return;
            }
            res.json({ message: "Package updated successfully" });
        } catch (err) {
            res.status(500).json({ error: err.message });
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

            const packageItems = normalizePackageItemsPayload(req.body);
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [existingRows] = await connection.execute("SELECT id FROM `package` WHERE serial_number = ?", [serialNumber]);
            if (existingRows.length === 0) {
                await connection.rollback();
                res.status(404).json({ error: "Package not found" });
                return;
            }

            await connection.execute("DELETE FROM `package` WHERE serial_number = ?", [serialNumber]);

            const insertSql = `
                INSERT INTO \`package\` (
                    serial_number,
                    package_label,
                    package_order,
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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            for (const item of packageItems) {
                await connection.execute(insertSql, [
                    serialNumber,
                    item.package_label,
                    item.package_order,
                    item.product_name,
                    item.product_code,
                    item.pieces,
                    item.length,
                    item.width,
                    item.height,
                    item.volume,
                    item.charge_weight,
                    item.package_type,
                    item.customs_port,
                    item.customs_title,
                    item.regulatory_conditions,
                    item.remark1,
                    item.remark2
                ]);
            }

            await connection.commit();
            res.json({ message: "Package updated successfully" });
        } catch (err) {
            if (connection) {
                await connection.rollback();
            }
            res.status(500).json({ error: err.message });
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
                return res.status(400).json({ error: "没有上传文件" });
            }

            const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                return res.status(400).json({ error: "Excel 文件为空或没有有效数据" });
            }

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
                message: "Excel 数据解析成功",
                data: validationResult.data
            });
        } catch (error) {
            console.error("Excel 解析错误:", error);
            res.status(500).json({ error: "Excel 文件解析失败: " + error.message });
        }
    });

    router.post("/import-excel", upload.single("excelFile"), async (req, res) => {
        try {
            await ensurePackageSchema(db);
            if (!req.file) {
                return res.status(400).json({ error: "没有上传文件" });
            }

            const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                return res.status(400).json({ error: "Excel 文件为空或没有有效数据" });
            }

            const results = {
                total: jsonData.length,
                success: 0,
                failed: 0,
                errors: [],
                successfulImports: []
            };

            for (let i = 0; i < jsonData.length; i++) {
                const rowData = jsonData[i];
                const rowNumber = i + 2;
                try {
                    const validationResult = validatePackageExcelData(rowData);

                    if (!validationResult.isValid) {
                        results.failed++;
                        results.errors.push({
                            row: rowNumber,
                            errors: validationResult.errors
                        });
                        continue;
                    }

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

                    const sql = "UPDATE `package` SET product_name = ?, product_code = ?, pieces = ?, length = ?, width = ?, height = ?, volume = ?, charge_weight = ?, package_type = ?, customs_port = ?, customs_title = ?, regulatory_conditions = ?, remark1 = ?, remark2 = ? WHERE serial_number = ?";
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
                            serial_number,
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

            res.json({
                success: results.failed === 0,
                message: `导入完成：共 ${results.total} 行，成功 ${results.success} 行，失败 ${results.failed} 行`,
                results
            });
        } catch (error) {
            console.error("Excel 导入错误:", error);
            res.status(500).json({ error: "Excel 文件导入失败: " + error.message });
        }
    });

    return router;
};

function validatePackageExcelData(data) {
    const result = {
        isValid: true,
        errors: [],
        data: {}
    };

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

    const requiredFields = ["serial_number"];

    for (const [excelField, dbField] of Object.entries(fieldMapping)) {
        if (data[excelField] !== undefined && data[excelField] !== null && data[excelField] !== "") {
            result.data[dbField] = data[excelField];
        }
    }

    for (const field of requiredFields) {
        if (!result.data[field] || result.data[field].toString().trim() === "") {
            const excelFieldNames = Object.keys(fieldMapping).filter(key => fieldMapping[key] === field);
            const excelFieldName = excelFieldNames.length > 0 ? excelFieldNames[0] : field;
            result.errors.push(`"${excelFieldName}" 字段为空，请检查 Excel 文件`);
            result.isValid = false;
        }
    }

    const numericFields = ["pieces", "length", "width", "height", "volume", "charge_weight"];
    for (const field of numericFields) {
        if (result.data[field] !== undefined) {
            const value = parseFloat(result.data[field]);
            if (Number.isNaN(value)) {
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
