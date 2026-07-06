const mysql = require('mysql2/promise');

async function fix() {
    const db = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'order_system'
    });
    
    // 插入缺失的报关记录
    const [result] = await db.execute(`
        INSERT INTO customs_clearance_tracking (serial_number)
        SELECT o.serial_number FROM orders o
        LEFT JOIN customs_clearance_tracking c ON o.serial_number = c.serial_number
        WHERE c.serial_number IS NULL
    `);
    
    console.log('新增报关记录数:', result.affectedRows);
    await db.end();
}

fix().catch(e => console.error(e));
