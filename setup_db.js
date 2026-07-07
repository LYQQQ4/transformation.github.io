const mysql = require("mysql2/promise");

async function setupDatabase() {
  const connection = await mysql.createConnection({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "Sidel!2345",
    ssl: false,
    connectTimeout: 60000
  });

  try {
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
        receive_date DATE NOT NULL COMMENT '接收指令日期',
        business_type VARCHAR(50) NOT NULL COMMENT '业务类型',
        customer_id VARCHAR(50) NOT NULL COMMENT '客户ID',
        sender_id VARCHAR(50) DEFAULT NULL COMMENT '发件人ID',
        shipping_address TEXT NOT NULL COMMENT '发货地址',
        sender_name VARCHAR(100) NOT NULL COMMENT '发件人',
        sender_phone VARCHAR(20) NOT NULL COMMENT '发件人电话',
        delivery_address TEXT NOT NULL COMMENT '收货地址',
        receiver_name VARCHAR(100) NOT NULL COMMENT '收件人',
        receiver_phone VARCHAR(20) NOT NULL COMMENT '收件人电话',
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
      await connection.execute(`
        ALTER TABLE orders ADD COLUMN serial_number VARCHAR(100) UNIQUE NOT NULL COMMENT '订单序列号'
      `);
      console.log("Added serial_number column to orders table.");
    } catch (error) {
      if (error.code === "ER_DUP_FIELDNAME") {
        console.log("serial_number column already exists.");
      } else {
        throw error;
      }
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

    // 删除现有的package表（如果存在），然后重新创建
    try {
      await connection.execute("DROP TABLE IF EXISTS package");
      console.log("Dropped existing package table.");
    } catch (error) {
      console.log("No existing package table to drop.");
    }

    // 创建package表（包装信息表）
    await connection.execute(`
      CREATE TABLE package (
        id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        serial_number VARCHAR(100) NOT NULL COMMENT '订单序列号',
        package_label VARCHAR(50) DEFAULT NULL COMMENT '包装标签',
        package_order INT DEFAULT 1 COMMENT '包装排序',
        product_name VARCHAR(200) DEFAULT NULL COMMENT '品名',
        product_code VARCHAR(100) DEFAULT NULL COMMENT '商品编号',
        pieces INT DEFAULT NULL COMMENT '件数',
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

    // 创建pickup_transport_tracking表（提货运输跟踪信息表）
    try {
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
    } catch (error) {
      if (error.code === "ER_TABLE_EXISTS_ERROR") {
        console.log("pickup_transport_tracking table already exists.");
      } else {
        throw error;
      }
    }

    // 创建products表（产品信息表）
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS products (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
          product_id VARCHAR(50) DEFAULT NULL COMMENT '产品ID(自动生成)',
          name_cn VARCHAR(200) DEFAULT NULL COMMENT '品名',
          description_en TEXT DEFAULT NULL COMMENT '英文描述',
          hs_code VARCHAR(50) DEFAULT NULL COMMENT 'HS CODE',
          declaration_elements TEXT DEFAULT NULL COMMENT '申报要素',
          origin VARCHAR(100) DEFAULT NULL COMMENT '产地',
          remark VARCHAR(1000) DEFAULT NULL COMMENT '备注',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          UNIQUE KEY uk_product_id (product_id),
          INDEX idx_name_cn (name_cn)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品信息表'
      `);
      console.log("Created products table.");
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log("products table already exists.");
      } else {
        throw err;
      }
    }

    // 创建transfer表（运输流转信息表）
    try {
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
    } catch (error) {
      if (error.code === "ER_TABLE_EXISTS_ERROR") {
        console.log("transfer table already exists.");
      } else {
        throw error;
      }
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

    // 创建guests表（客户信息表）
    // 先删除现有的表（如果存在）以重新创建
    try {
      await connection.execute("DROP TABLE IF EXISTS guests");
      console.log("Dropped existing guests table.");
    } catch (error) {
      console.log("No existing guests table to drop.");
    }

    await connection.execute(`
      CREATE TABLE guests (
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
        sender_phone VARCHAR(20) COMMENT '发件人电话',
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
        receiver_phone VARCHAR(20) COMMENT '收件人电话',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_receiver_name (receiver_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户信息库'
    `);
    console.log("Created customer_info table.");

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

    console.log("Database setup completed successfully.");
  } catch (error) {
    console.error("Error setting up database:", error);
  } finally {
    await connection.end();
  }
}

setupDatabase();
