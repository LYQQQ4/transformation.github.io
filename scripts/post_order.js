const http = require('http');

const data = JSON.stringify({
  company_name: '测试公司',
  orderer: '张三',
  receive_date: '2026-01-22',
  business_type: '出口',
  customer_id: 'CUST123',
  shipping_address: '地址',
  sender_name: '发件人',
  sender_phone: '13800138000',
  delivery_address: '收货地址',
  receiver_name: '收件人',
  receiver_phone: '13800138001',
  origin: '上海',
  destination: '北京',
  trade_term: 'FOB'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/orders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('Response body:', body);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
