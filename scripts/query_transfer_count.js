const mysql = require('mysql2/promise');

(async () => {
  const dbConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'Sidel!2345',
    database: 'order_system'
  };

  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT COUNT(*) AS cnt FROM transfer');
    console.log('transfer count:', rows[0].cnt);
    const [sample] = await conn.execute('SELECT * FROM transfer ORDER BY id DESC LIMIT 5');
    console.log('latest rows:', sample);
    await conn.end();
  } catch (err) {
    console.error('DB error:', err.message);
    process.exit(1);
  }
})();
