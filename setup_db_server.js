require('dotenv').config();
const mysql = require('mysql2/promise');

/**
 * 服务器数据库初始化脚本
 * 从环境变量（.env）读取数据库配置，自动创建所有需要的表
 * 支持跨平台部署，零硬编码
 */

// 从环境变量读取数据库配置
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT) || 60000
};

const userDbConfig = {
  host: process.env.USER_DB_HOST || dbConfig.host,
  port: parseInt(process.env.USER_DB_PORT) || dbConfig.port,
  user: process.env.USER_DB_USER || dbConfig.user,
  password: process.env.USER_DB_PASSWORD || dbConfig.password,
  ssl: process.env.DB_SSL === 'true' ? {} : false,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT) || 60000
};

const ORDER_SYSTEM_DB = process.env.DB_NAME || 'order_system';
const USER_SYSTEM_DB = process.env.USER_DB_NAME || 'user_system';

console.log(`
╔════════════════════════════════════════════════════════════════╗
║                   数据库初始化脚本                              ║
║               正在连接数据库并创建所需表结构...                  ║
╚════════════════════════════════════════════════════════════════╝
┌────────────────────────────────────────────────────────────────┐
│ 配置信息：
│ Order DB: ${ORDER_SYSTEM_DB} (${dbConfig.host}:${dbConfig.port})
│ User DB:  ${USER_SYSTEM_DB} (${userDbConfig.host}:${userDbConfig.port})
└────────────────────────────────────────────────────────────────┘
`);

async function setupDatabase() {
  let connection = null;
  
  try {
    // 使用root账户连接以创建数据库
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 已连接到数据库服务器');

    // 创建数据库（如果不存在）
    console.log(`\n[1/3] 正在创建数据库...`);
    await connection.execute(
      `CREATE DATABASE IF NOT EXISTS ${ORDER_SYSTEM_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`✓ 数据库 '${ORDER_SYSTEM_DB}' 已创建或已存在`);

    await connection.execute(
      `CREATE DATABASE IF NOT EXISTS ${USER_SYSTEM_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`✓ 数据库 '${USER_SYSTEM_DB}' 已创建或已存在`);

    // ============================================
    // 创建 order_system 数据库的表
    // ============================================
    console.log(`\n[2/3] 正在创建 '${ORDER_SYSTEM_DB}' 数据库的表结构...`);
    await connection.changeUser({ database: ORDER_SYSTEM_DB });

    // 1. 创建orders表
    console.log('  • 创建 orders 表...');
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
        serial_number VARCHAR(100) UNIQUE COMMENT '订单序列号',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_customer_id (customer_id),
        INDEX idx_receive_date (receive_date),
        INDEX idx_serial_number (serial_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单信息表'
    `);
    console.log('    ✓ orders 表已创建');

    // 2. 创建package表
    console.log('  • 创建 package 表...');
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
    console.log('    ✓ package 表已创建');

    // 3. 创建pickup_transport_tracking表
    console.log('  • 创建 pickup_transport_tracking 表...');
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
    console.log('    ✓ pickup_transport_tracking 表已创建');

    // 4. 创建products表
    console.log('  • 创建 products 表...');
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
    console.log('    ✓ products 表已创建');

    // 5. 创建transfer表
    console.log('  • 创建 transfer 表...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS transfer (
        id INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
        serial_number VARCHAR(100) NOT NULL COMMENT '流水号',
        transport_mode VARCHAR(50) DEFAULT NULL COMMENT '运输方式',
        tracking_number VARCHAR(100) DEFAULT NULL COMMENT '运单号',
        contract_number VARCHAR(100) DEFAULT NULL COMMENT '合同协议号',
        pickup_date DATE DEFAULT NULL COMMENT '提货日期',
        arrival_port_time DATETIME DEFAULT NULL COMMENT '到港时间',
        clearance_time DATETIME DEFAULT NULL COMMENT '放行时间',
        delivery_time DATETIME DEFAULT NULL COMMENT '送达时间',
        complete_docs_send_time DATETIME DEFAULT NULL COMMENT '完整资料发送时间',
        cargo_flow_info TEXT COMMENT '货物流转信息',
        supplier VARCHAR(200) DEFAULT NULL COMMENT '供应商',
        value_added_services TEXT COMMENT '增值服务备注',
        billing_period VARCHAR(50) DEFAULT NULL COMMENT '账单期',
        remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
        remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
        remark3 VARCHAR(1000) DEFAULT NULL COMMENT '备注3',
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (id),
        UNIQUE KEY uk_serial_number (serial_number),
        UNIQUE KEY uk_tracking_number (tracking_number),
        KEY idx_pickup_date (pickup_date),
        KEY idx_supplier (supplier(50))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运输流转信息表'
    `);
    console.log('    ✓ transfer 表已创建');

    // 6. 创建customs_clearance_tracking表（订单库）
    console.log('  • 创建 customs_clearance_tracking 表（order_system）...');
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
    console.log('    ✓ customs_clearance_tracking 表已创建（order_system）');

    // ============================================
    // 创建 user_system 数据库的表
    // ============================================
    console.log(`\n[3/3] 正在创建 '${USER_SYSTEM_DB}' 数据库的表结构...`);
    await connection.changeUser({ database: USER_SYSTEM_DB });

    // 1. 创建users表
    console.log('  • 创建 users 表...');
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
    console.log('    ✓ users 表已创建');

    // 2. 创建guests表
    console.log('  • 创建 guests 表...');
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
    console.log('    ✓ guests 表已创建');

    // 3. 创建sender_info表
    console.log('  • 创建 sender_info 表...');
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
    console.log('    ✓ sender_info 表已创建');

    // 4. 创建customer_info表
    console.log('  • 创建 customer_info 表...');
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
    console.log('    ✓ customer_info 表已创建');

    // 5. 创建customs_clearance_tracking表
    console.log('  • 创建 customs_clearance_tracking 表...');
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
    console.log('    ✓ customs_clearance_tracking 表已创建');

    console.log('  • 创建 user_profiles 表...');
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
    console.log('    ✓ user_profiles 表已创建');

    console.log('  • 创建 user_profile_migration_map 表...');
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
    console.log('    ✓ user_profile_migration_map 表已创建');

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                     ✓ 数据库初始化成功！                       ║
╚════════════════════════════════════════════════════════════════╝
┌────────────────────────────────────────────────────────────────┐
│ 已创建的表：
│
│ ${ORDER_SYSTEM_DB} 数据库：
│   1. orders                      - 订单信息表
│   2. package                     - 包裹信息表
│   3. pickup_transport_tracking   - 提货运输跟踪表
│   4. products                    - 产品信息表
│   5. transfer                    - 运输流转信息表
│
│ ${USER_SYSTEM_DB} 数据库：
│   1. users                       - 用户表
│   2. guests                      - 客户信息表
│   3. sender_info                 - 发件人信息库
│   4. customer_info               - 客户信息库
│   5. customs_clearance_tracking  - 报关信息维护跟踪表
│
│ 总计：10 个数据表已创建
└────────────────────────────────────────────────────────────────┘
    `);

  } catch (error) {
    console.error(`
╔════════════════════════════════════════════════════════════════╗
║                     ✗ 数据库初始化失败！                       ║
╚════════════════════════════════════════════════════════════════╝
    `);
    console.error('❌ 错误详情：', error.message);
    console.error('\n💡 可能的原因：');
    console.error('   1. 数据库服务未启动或无法连接');
    console.error('   2. 用户名或密码错误');
    console.error('   3. .env 文件配置不正确');
    console.error('   4. 数据库权限不足');
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 运行初始化
setupDatabase().then(() => {
  console.log('✓ 脚本执行完成');
  process.exit(0);
}).catch(err => {
  console.error('✗ 脚本执行出错:', err);
  process.exit(1);
});
