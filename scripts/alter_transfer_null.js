const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'Sidel!2345',
      database: 'order_system'
    });

    await conn.execute("ALTER TABLE transfer MODIFY COLUMN tracking_number VARCHAR(100) NULL DEFAULT NULL");
    console.log('Altered transfer.tracking_number to NULL DEFAULT NULL');
    await conn.end();
  } catch (err) {
    console.error('Alter failed:', err.message);
    process.exit(1);
  }
})();
