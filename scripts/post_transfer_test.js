const http = require('http');

const data = JSON.stringify({
  serial_number: null,
  transport_mode: '海运',
  tracking_number: 'TNTEST0001',
  contract_number: null,
  pickup_date: null,
  arrival_port_time: null,
  clearance_time: null,
  delivery_time: null,
  complete_docs_send_time: null,
  cargo_flow_info: null,
  supplier: '测试供应商',
  value_added_services: null,
  billing_period: null,
  remark1: null,
  remark2: null,
  remark3: null
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/transfers',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  console.log('Status:', res.statusCode);
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Body:', body);
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(data);
req.end();
