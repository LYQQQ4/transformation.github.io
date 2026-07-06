const http = require('http');

// Simple test for guests API
function testGuestsAPI() {
  console.log('Testing guests API...');

  // Test GET /api/guests
  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/guests',
    method: 'GET'
  }, (res) => {
    console.log('GET /api/guests status:', res.statusCode);
    console.log('Content-Type:', res.headers['content-type']);

    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        const jsonData = JSON.parse(data);
        console.log('GET response:', jsonData);
      } catch (e) {
        console.log('GET response (non-JSON):', data);
      }
      console.log('Guests API test completed.');
    });
  });

  req.on('error', (e) => {
    console.error('GET request failed:', e.message);
  });

  req.end();
}

testGuestsAPI();
