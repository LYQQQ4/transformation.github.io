const mysql = require('mysql2/promise');

(async () => {
  const dbConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'Sidel!2345',
    database: 'order_system'
  };

  const conn = await mysql.createConnection(dbConfig);
  try {
    const serial = '202601001';
    const transport_mode = '海运';
    const tracking_number = 'TNTEST0001';
    const contract_number = 'HT202601A';
    const pickup_date = '2026-01-10';
    const arrival_port_time = '2026-01-15 09:00:00';
    const clearance_time = '2026-01-16 14:00:00';
    const delivery_time = '2026-01-18 17:30:00';
    const complete_docs_send_time = null;
    const cargo_flow_info = null;
    const supplier = '测试供应商';
    const value_added_services = null;
    const billing_period = null;
    const remark1 = null;
    const remark2 = null;
    const remark3 = null;

    const [result] = await conn.execute(
      `INSERT INTO transfer (
        serial_number, transport_mode, tracking_number, contract_number,
        pickup_date, arrival_port_time, clearance_time, delivery_time,
        complete_docs_send_time, cargo_flow_info, supplier, value_added_services,
        billing_period, remark1, remark2, remark3
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [serial, transport_mode, tracking_number, contract_number,
        pickup_date, arrival_port_time, clearance_time, delivery_time,
        complete_docs_send_time, cargo_flow_info, supplier, value_added_services,
        billing_period, remark1, remark2, remark3]
    );
    console.log('Inserted id:', result.insertId);
    const [rows] = await conn.execute('SELECT * FROM transfer WHERE id = ?', [result.insertId]);
    console.log('Row:', rows[0]);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await conn.end();
  }
})();
