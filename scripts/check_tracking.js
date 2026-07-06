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

    const [rows] = await conn.execute('SELECT id, tracking_number FROM transfer ORDER BY id LIMIT 100');
    console.log('transfer sample rows (up to 100):');
    console.table(rows);
    await conn.end();
  } catch (err) {
    console.error('DB check failed:', err.message);
    process.exit(1);
  }
})();
