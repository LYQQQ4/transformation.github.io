const http = require('http');
http.get('http://localhost:3000/api/packages', (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('STATUS', res.statusCode, 'BODY', body));
}).on('error', (e) => console.error(e));
