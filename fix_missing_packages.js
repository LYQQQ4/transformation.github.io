const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Sidel!2345',
    database: 'order_system'
  });
  
  // 查找orders表中存在但package表中缺失的serial_number
  const [missing] = await conn.execute(`
    SELECT o.serial_number 
    FROM orders o 
    LEFT JOIN \`package\` p ON o.serial_number = p.serial_number 
    WHERE p.serial_number IS NULL
  `);
  
  console.log('缺失的package记录数:', missing.length);
  
  // 为缺失的记录插入package
  for (const row of missing) {
    await conn.execute('INSERT INTO `package` (serial_number) VALUES (?)', [row.serial_number]);
    console.log('已创建:', row.serial_number);
  }
  
  console.log('完成');
  await conn.end();
})();
