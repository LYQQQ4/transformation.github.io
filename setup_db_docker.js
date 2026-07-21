require('dotenv').config();
const mysql = require("mysql2/promise");

async function setupDatabase() {
  const connection = await mysql.createConnection({
    // Prefer local MySQL by default; Docker can still pass DB_HOST=db explicitly.
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    ssl: false,
    connectTimeout: 60000
  });

  try {
    console.log("开始初始化数据库...");
    
    // 创建数据库如果不存在
    await connection.execute("CREATE DATABASE IF NOT EXISTS order_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    await connection.execute("CREATE DATABASE IF NOT EXISTS user_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

    // 切换到order_system数据库
    await connection.changeUser({ database: "order_system" });

    // 创建orders表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        company_name VARCHAR(200) NOT NULL COMMENT '公司抬头',
        orderer VARCHAR(100) NOT NULL COMMENT '指令人',
        receive_date DATE DEFAULT NULL COMMENT '接收指令日期',
        business_type VARCHAR(50) NOT NULL COMMENT '业务类型',
        customer_id VARCHAR(50) NOT NULL COMMENT '客户ID',
        sender_id VARCHAR(50) DEFAULT NULL COMMENT '发件人ID',
        shipping_address TEXT NOT NULL COMMENT '发货地址',
        sender_name VARCHAR(100) NOT NULL COMMENT '发件人',
        sender_phone VARCHAR(255) NOT NULL COMMENT '发件人电话',
        delivery_address TEXT NOT NULL COMMENT '收货地址',
        receiver_name VARCHAR(100) NOT NULL COMMENT '收件人',
        receiver_phone VARCHAR(255) NOT NULL COMMENT '收件人电话',
        origin VARCHAR(100) NOT NULL COMMENT '始发地',
        destination VARCHAR(100) NOT NULL COMMENT '目的地',
        trade_term VARCHAR(50) COMMENT '贸易术语',
        product_name VARCHAR(200) DEFAULT NULL COMMENT '货物品名',
        remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
        remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_customer_id (customer_id),
        INDEX idx_receive_date (receive_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单信息表'
    `);

    // 检查并添加serial_number字段（如果不存在）
    try {
      // 先检查字段是否存在
      const [columns] = await connection.execute(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = 'order_system' 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME = 'serial_number'
      `);
      
      if (columns.length === 0) {
        // 字段不存在，先添加字段（不设置唯一约束）
        await connection.execute(`
          ALTER TABLE orders ADD COLUMN serial_number VARCHAR(100) COMMENT '订单序列号'
        `);
        console.log("Added serial_number column to orders table.");
        
        // 如果表中没有数据，可以添加唯一约束
        const [rows] = await connection.execute("SELECT COUNT(*) as count FROM orders");
        if (rows[0].count === 0) {
          await connection.execute(`
            ALTER TABLE orders ADD UNIQUE KEY unique_serial_number (serial_number)
          `);
          console.log("Added unique constraint on serial_number.");
        }
      } else {
        console.log("serial_number column already exists.");
      }
    } catch (error) {
      console.log("serial_number column handling:", error.message);
    }

    // 检查并补充orders表新字段
    const orderColumnDefinitions = [
      { name: "sender_id", sql: "ALTER TABLE orders ADD COLUMN sender_id VARCHAR(50) DEFAULT NULL COMMENT '发件人ID'" },
      { name: "product_name", sql: "ALTER TABLE orders ADD COLUMN product_name VARCHAR(200) DEFAULT NULL COMMENT '货物品名'" },
      { name: "remark1", sql: "ALTER TABLE orders ADD COLUMN remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1'" },
      { name: "remark2", sql: "ALTER TABLE orders ADD COLUMN remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2'" }
    ];

    for (const column of orderColumnDefinitions) {
      const [orderColumns] = await connection.execute(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'order_system'
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = ?
      `, [column.name]);

      if (orderColumns.length === 0) {
        await connection.execute(column.sql);
        console.log(`Added ${column.name} column to orders table.`);
      }
    }

    // 创建package表（包装信息表）- 使用 IF NOT EXISTS 避免删除现有数据
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS package (
        id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        serial_number VARCHAR(100) NOT NULL COMMENT '订单序列号',
        package_label VARCHAR(50) DEFAULT NULL COMMENT '包装标签',
        package_order INT DEFAULT 1 COMMENT '包装排序',
        product_name VARCHAR(200) DEFAULT NULL COMMENT '品名',
        product_code VARCHAR(100) DEFAULT NULL COMMENT '商品编号',
        pieces INT DEFAULT NULL COMMENT '件数',
        single_weight DOUBLE DEFAULT NULL COMMENT '单件重量',
        length DOUBLE DEFAULT NULL COMMENT '长',
        width DOUBLE DEFAULT NULL COMMENT '宽',
        height DOUBLE DEFAULT NULL COMMENT '高',
        volume DOUBLE DEFAULT NULL COMMENT '体积',
        charge_weight DOUBLE DEFAULT NULL COMMENT '计费重量',
        package_type VARCHAR(255) DEFAULT NULL COMMENT '包装种类',
        customs_port VARCHAR(100) DEFAULT NULL COMMENT '报关口岸',
        customs_title VARCHAR(200) DEFAULT NULL COMMENT '报关抬头',
        regulatory_conditions VARCHAR(500) DEFAULT NULL COMMENT '监管条件',
        remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
        remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_serial_number (serial_number),
        INDEX idx_serial_package_order (serial_number, package_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='包裹信息表'
    `);

    console.log("Created package table.");

    // 检查并补充package表新字段
    const packageColumnDefinitions = [
      { name: "product_name", sql: "ALTER TABLE package ADD COLUMN product_name VARCHAR(200) DEFAULT NULL COMMENT '品名'" },
      { name: "product_code", sql: "ALTER TABLE package ADD COLUMN product_code VARCHAR(100) DEFAULT NULL COMMENT '商品编号'" },
      { name: "pieces", sql: "ALTER TABLE package ADD COLUMN pieces INT DEFAULT NULL COMMENT '件数'" },
      { name: "single_weight", sql: "ALTER TABLE package ADD COLUMN single_weight DOUBLE DEFAULT NULL COMMENT '单件重量'" },
      { name: "length", sql: "ALTER TABLE package ADD COLUMN length DOUBLE DEFAULT NULL COMMENT '长'" },
      { name: "width", sql: "ALTER TABLE package ADD COLUMN width DOUBLE DEFAULT NULL COMMENT '宽'" },
      { name: "height", sql: "ALTER TABLE package ADD COLUMN height DOUBLE DEFAULT NULL COMMENT '高'" }
    ];

    for (const column of packageColumnDefinitions) {
      const [pkgColumns] = await connection.execute(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'order_system'
        AND TABLE_NAME = 'package'
        AND COLUMN_NAME = ?
      `, [column.name]);

      if (pkgColumns.length === 0) {
        await connection.execute(column.sql);
        console.log(`Added ${column.name} column to package table.`);
      }
    }

    // 创建pickup_transport_tracking表（提货运输跟踪信息表）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS pickup_transport_tracking (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        serial_number VARCHAR(100) NOT NULL COMMENT '订单序列号',
        transport_mode VARCHAR(50) DEFAULT NULL COMMENT '运输方式',
        tracking_number VARCHAR(100) DEFAULT NULL COMMENT '运单号',
        origin VARCHAR(100) DEFAULT NULL COMMENT '始发地',
        destination VARCHAR(100) DEFAULT NULL COMMENT '目的地',
        customs_port VARCHAR(100) DEFAULT NULL COMMENT '报关口岸',
        customs_title VARCHAR(200) DEFAULT NULL COMMENT '报关抬头',
        pickup_date DATE DEFAULT NULL COMMENT '提货日期',
        arrival_time DATETIME DEFAULT NULL COMMENT '到货时间',
        transport_supplier VARCHAR(200) DEFAULT NULL COMMENT '运输供应商',
        contract_number VARCHAR(100) DEFAULT NULL COMMENT '合同协议号',
        cargo_flow_info TEXT DEFAULT NULL COMMENT '货物流转信息',
        value_added_services TEXT DEFAULT NULL COMMENT '增值服务备注',
        remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
        remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY uk_serial_number (serial_number),
        KEY idx_tracking_number (tracking_number),
        KEY idx_pickup_date (pickup_date),
        KEY idx_transport_supplier (transport_supplier(50))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='提货运输跟踪信息表'
    `);

    console.log("Created pickup_transport_tracking table.");

    // 检查并补充pickup_transport_tracking表新字段
    const pickupTrackingColumnDefinitions = [
      { name: "transport_mode", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN transport_mode VARCHAR(50) DEFAULT NULL COMMENT '运输方式'" },
      { name: "tracking_number", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN tracking_number VARCHAR(100) DEFAULT NULL COMMENT '运单号'" },
      { name: "origin", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN origin VARCHAR(100) DEFAULT NULL COMMENT '始发地'" },
      { name: "destination", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN destination VARCHAR(100) DEFAULT NULL COMMENT '目的地'" },
      { name: "customs_port", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN customs_port VARCHAR(100) DEFAULT NULL COMMENT '报关口岸'" },
      { name: "customs_title", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN customs_title VARCHAR(200) DEFAULT NULL COMMENT '报关抬头'" },
      { name: "pickup_date", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN pickup_date DATE DEFAULT NULL COMMENT '提货日期'" },
      { name: "arrival_time", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN arrival_time DATETIME DEFAULT NULL COMMENT '到货时间'" },
      { name: "transport_supplier", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN transport_supplier VARCHAR(200) DEFAULT NULL COMMENT '运输供应商'" },
      { name: "contract_number", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN contract_number VARCHAR(100) DEFAULT NULL COMMENT '合同协议号'" },
      { name: "cargo_flow_info", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN cargo_flow_info TEXT DEFAULT NULL COMMENT '货物流转信息'" },
      { name: "value_added_services", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN value_added_services TEXT DEFAULT NULL COMMENT '增值服务备注'" },
      { name: "remark1", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1'" },
      { name: "remark2", sql: "ALTER TABLE pickup_transport_tracking ADD COLUMN remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2'" }
    ];

    for (const column of pickupTrackingColumnDefinitions) {
      const [trackingColumns] = await connection.execute(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'order_system'
        AND TABLE_NAME = 'pickup_transport_tracking'
        AND COLUMN_NAME = ?
      `, [column.name]);

      if (trackingColumns.length === 0) {
        await connection.execute(column.sql);
        console.log(`Added ${column.name} column to pickup_transport_tracking table.`);
      }
    }

    // 创建transfer表（运输流转信息表）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS transfer (
        id int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
        serial_number varchar(100) NOT NULL COMMENT '流水号',
        transport_mode varchar(50) DEFAULT NULL COMMENT '运输方式',
          tracking_number varchar(100) DEFAULT NULL COMMENT '运单号',
        contract_number varchar(100) DEFAULT NULL COMMENT '合同协议号',
        pickup_date date DEFAULT NULL COMMENT '提货日期',
        arrival_port_time datetime DEFAULT NULL COMMENT '到港时间',
        clearance_time datetime DEFAULT NULL COMMENT '放行时间',
        delivery_time datetime DEFAULT NULL COMMENT '送达时间',
        complete_docs_send_time datetime DEFAULT NULL COMMENT '完整资料发送时间',
        cargo_flow_info text COMMENT '货物流转信息',
        supplier varchar(200) DEFAULT NULL COMMENT '供应商',
        value_added_services text COMMENT '增值服务备注',
        billing_period varchar(50) DEFAULT NULL COMMENT '账单期',
        remark1 varchar(1000) DEFAULT NULL COMMENT '备注1',
        remark2 varchar(1000) DEFAULT NULL COMMENT '备注2',
        remark3 varchar(1000) DEFAULT NULL COMMENT '备注3',
        create_time datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        update_time datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (id),
        UNIQUE KEY uk_serial_number (serial_number),
        UNIQUE KEY uk_tracking_number (tracking_number),
        KEY idx_pickup_date (pickup_date),
        KEY idx_supplier (supplier(50))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运输流转信息表'
    `);

    console.log("Created transfer table.");

    // 为已有缺失的 tracking_number 按 id 顺序填充值，格式 TN00000001
    try {
      await connection.execute(`
        UPDATE transfer
        SET tracking_number = CONCAT('TN', LPAD(id,8,'0'))
        WHERE tracking_number IS NULL OR tracking_number = ''
      `);
      console.log("Filled missing tracking_number values in transfer table.");
    } catch (err) {
      console.log("Error filling tracking_number:", err.message);
    }

    // 在 order_system 中创建报关信息维护跟踪表（供 /api/customs-clearance 使用）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS customs_clearance_tracking (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        serial_number VARCHAR(50) NOT NULL COMMENT '流水号',
        customs_start_time DATETIME DEFAULT NULL COMMENT '开始报关时间',
        tax_payment_time DATETIME DEFAULT NULL COMMENT '付税时间',
        release_time DATETIME DEFAULT NULL COMMENT '放行时间',
        customs_declaration_number VARCHAR(100) DEFAULT NULL COMMENT '报关单号',
        customs_supplier VARCHAR(200) DEFAULT NULL COMMENT '报关供应商',
        remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
        remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_serial_number (serial_number),
        INDEX idx_customs_start_time (customs_start_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报关信息维护跟踪表'
    `);
    console.log("Created customs_clearance_tracking table in order_system.");

    // 切换到user_system数据库
    await connection.changeUser({ database: "user_system" });

    // 创建users表（如果不存在）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        username VARCHAR(100) NOT NULL UNIQUE COMMENT '用户名',
        password VARCHAR(255) NOT NULL COMMENT '密码',
        password_hash VARCHAR(255) COMMENT '密码哈希',
        role VARCHAR(20) DEFAULT 'user' COMMENT '角色',
        email VARCHAR(100) COMMENT '邮箱',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表'
    `);

    console.log("Created users table.");

    // 创建guests表（客户信息表）- 使用 IF NOT EXISTS 避免删除现有数据
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS guests (
        guest_id VARCHAR(50) PRIMARY KEY COMMENT '客户ID（手动输入）',
        region VARCHAR(100) COMMENT '地区',
        company_cn VARCHAR(200) COMMENT '中文公司名称',
        company_en VARCHAR(200) COMMENT '英文公司名称',
        address_cn TEXT COMMENT '中文地址',
        address_en TEXT COMMENT '英文地址',
        postcode VARCHAR(20) COMMENT '邮编',
        contact_name VARCHAR(100) NOT NULL COMMENT '联系人姓名',
        phone VARCHAR(50) COMMENT '电话',
        email VARCHAR(100) COMMENT '邮箱',
        tax_no VARCHAR(50) COMMENT '税号/欧盟号',
        customs_10digit VARCHAR(20) COMMENT '海关10位数',
        remark TEXT COMMENT '备注',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_contact_name (contact_name),
        INDEX idx_company_cn (company_cn),
        INDEX idx_region (region)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户信息表'
    `);

    console.log("Created guests table.");

    // 创建发件人信息库表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS sender_info (
        sender_id VARCHAR(50) PRIMARY KEY COMMENT '发件人ID',
        shipping_address TEXT COMMENT '发货地址',
        sender_name VARCHAR(100) COMMENT '发件人',
        sender_phone VARCHAR(255) COMMENT '发件人电话',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_sender_name (sender_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发件人信息库'
    `);
    console.log("Created sender_info table.");

    // 创建客户信息库表（简化版）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS customer_info (
        customer_id VARCHAR(50) PRIMARY KEY COMMENT '客户ID',
        delivery_address TEXT COMMENT '收货地址',
        receiver_name VARCHAR(100) COMMENT '收件人',
        receiver_phone VARCHAR(255) COMMENT '收件人电话',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_receiver_name (receiver_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户信息库'
    `);
    console.log("Created customer_info table.");

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id VARCHAR(50) PRIMARY KEY COMMENT '用户ID，国家代码+编号',
        country_code VARCHAR(10) NOT NULL COMMENT '国家代码',
        sequence_no INT NOT NULL COMMENT '国家内顺序号',
        company_name VARCHAR(200) DEFAULT NULL COMMENT '公司名称',
        address TEXT DEFAULT NULL COMMENT '地址',
        contact_name VARCHAR(100) DEFAULT NULL COMMENT '联系人姓名',
        phone VARCHAR(50) DEFAULT NULL COMMENT '电话',
        email VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
        remark TEXT DEFAULT NULL COMMENT '备注',
        dedupe_key VARCHAR(255) DEFAULT NULL COMMENT '去重键',
        source_type VARCHAR(20) DEFAULT 'manual' COMMENT '来源类型',
        legacy_sender_id VARCHAR(50) DEFAULT NULL COMMENT '原发件人ID',
        legacy_customer_id VARCHAR(50) DEFAULT NULL COMMENT '原客户ID',
        migration_batch VARCHAR(32) DEFAULT NULL COMMENT '迁移批次',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY uk_user_profiles_dedupe_key (dedupe_key),
        KEY idx_user_profiles_country_code (country_code),
        KEY idx_user_profiles_contact_name (contact_name),
        KEY idx_user_profiles_legacy_sender_id (legacy_sender_id),
        KEY idx_user_profiles_legacy_customer_id (legacy_customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='统一用户信息库'
    `);
    console.log("Created user_profiles table.");

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_profile_migration_map (
        legacy_type VARCHAR(20) NOT NULL COMMENT '旧类型 sender/customer',
        legacy_id VARCHAR(50) NOT NULL COMMENT '旧ID',
        user_profile_id VARCHAR(50) NOT NULL COMMENT '新用户ID',
        migration_batch VARCHAR(32) NOT NULL COMMENT '迁移批次',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        PRIMARY KEY (legacy_type, legacy_id),
        KEY idx_user_profile_id (user_profile_id),
        KEY idx_migration_batch (migration_batch)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户信息库迁移映射表'
    `);
    console.log("Created user_profile_migration_map table.");

    // 创建报关信息维护跟踪表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS customs_clearance_tracking (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        serial_number VARCHAR(50) NOT NULL COMMENT '流水号',
        customs_start_time DATETIME DEFAULT NULL COMMENT '开始报关时间',
        tax_payment_time DATETIME DEFAULT NULL COMMENT '付税时间',
        release_time DATETIME DEFAULT NULL COMMENT '放行时间',
        customs_declaration_number VARCHAR(100) DEFAULT NULL COMMENT '报关单号',
        customs_supplier VARCHAR(200) DEFAULT NULL COMMENT '报关供应商',
        remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
        remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_serial_number (serial_number),
        INDEX idx_customs_start_time (customs_start_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报关信息维护跟踪表'
    `);
    console.log("Created customs_clearance_tracking table.");

    console.log("✅ 数据库初始化完成！");
  } catch (error) {
    console.error("❌ 数据库初始化失败:", error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

setupDatabase();
