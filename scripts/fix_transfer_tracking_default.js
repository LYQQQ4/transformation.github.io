const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'Sidel!2345',
      database: 'order_system',
      connectTimeout: 10000
    });

    // 修改列默认值
    await conn.execute(`ALTER TABLE transfer MODIFY COLUMN tracking_number VARCHAR(100) NOT NULL DEFAULT ''`);
    console.log('Modified tracking_number column to NOT NULL DEFAULT ""');

    // 填充缺失的值
    const [result] = await conn.execute(`UPDATE transfer SET tracking_number = CONCAT('TN', LPAD(id,8,'0')) WHERE tracking_number IS NULL OR tracking_number = ''`);
    console.log('Updated rows:', result.affectedRows);

    await conn.end();
  } catch (err) {
    console.error('DB alter failed:', err.message);
    process.exit(1);
  }
})();
