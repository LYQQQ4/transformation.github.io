const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Sidel!2345',
    database: 'order_system'
  });
  
  await conn.execute(`
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
  
  console.log('Created customs_clearance_tracking table in order_system.');
  await conn.end();
})();
