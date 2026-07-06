const mysql = require('mysql2/promise');
 (async ()=>{
  try {
    const c = await mysql.createConnection({host:'localhost',port:3306,user:'root',password:'Sidel!2345',database:'order_system'});
    const query = "SELECT p.*, o.company_name, o.orderer, o.business_type, o.customer_id FROM `package` p LEFT JOIN orders o ON p.serial_number = o.serial_number ORDER BY p.created_at DESC LIMIT 20";
    const [r] = await c.execute(query);
    console.log('rows length', r.length);
    console.table(r);
    await c.end();
  } catch (e) {
    console.error('query error', e.message);
  }
})();
