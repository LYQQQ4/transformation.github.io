const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Sidel!2345',
    database: 'order_system'
  });
  
  // 补充缺失的 pickup_transport_tracking 记录
  const [missingPickup] = await conn.execute(`
    SELECT o.serial_number 
    FROM orders o 
    LEFT JOIN pickup_transport_tracking p ON o.serial_number = p.serial_number 
    WHERE p.serial_number IS NULL
  `);
  
  console.log('缺失的pickup_transport_tracking记录数:', missingPickup.length);
  
  for (const row of missingPickup) {
    await conn.execute('INSERT INTO pickup_transport_tracking (serial_number) VALUES (?)', [row.serial_number]);
    console.log('已创建pickup_transport_tracking:', row.serial_number);
  }
  
  // 补充缺失的 customs_clearance_tracking 记录
  const [missingCustoms] = await conn.execute(`
    SELECT o.serial_number 
    FROM orders o 
    LEFT JOIN customs_clearance_tracking c ON o.serial_number = c.serial_number 
    WHERE c.serial_number IS NULL
  `);
  
  console.log('缺失的customs_clearance_tracking记录数:', missingCustoms.length);
  
  for (const row of missingCustoms) {
    await conn.execute('INSERT INTO customs_clearance_tracking (serial_number) VALUES (?)', [row.serial_number]);
    console.log('已创建customs_clearance_tracking:', row.serial_number);
  }
  
  // 补充缺失的 transfer 记录
  const [missingTransfer] = await conn.execute(`
    SELECT o.serial_number 
    FROM orders o 
    LEFT JOIN transfer t ON o.serial_number = t.serial_number 
    WHERE t.serial_number IS NULL
  `);
  
  console.log('缺失的transfer记录数:', missingTransfer.length);
  
  // 获取当前最大ID用于生成唯一tracking_number
  const [maxIdResult] = await conn.execute('SELECT COALESCE(MAX(id), 0) as maxId FROM transfer');
  let nextId = maxIdResult[0].maxId + 1;
  
  for (const row of missingTransfer) {
    const trackingNumber = 'TN' + String(nextId).padStart(8, '0');
    await conn.execute('INSERT INTO transfer (serial_number, tracking_number) VALUES (?, ?)', [row.serial_number, trackingNumber]);
    console.log('已创建transfer:', row.serial_number, '运单号:', trackingNumber);
    nextId++;
  }
  
  console.log('所有关联表记录补充完成');
  await conn.end();
})();
