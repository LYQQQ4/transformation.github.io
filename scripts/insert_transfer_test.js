const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'Sidel!2345',
      database: 'order_system',
    });
    try {
      const [res] = await conn.execute("INSERT INTO transfer (serial_number) VALUES ('ZZZ_TEST')");
      console.log('Insert OK, id=', res.insertId);
    } catch (e) {
      console.error('Insert failed:', e.message);
    }
    await conn.end();
  } catch (err) {
    console.error('Conn fail:', err.message);
  }
})();
