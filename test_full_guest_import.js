const fs = require('fs');
const http = require('http');
const FormData = require('form-data');

// Test complete guest import functionality
function testFullGuestImport() {
  console.log('Testing complete guest import functionality...');

  try {
    // Read the Excel file
    const excelPath = 'c:/Users/lin/Desktop/test_guests.xlsx';
    const fileStream = fs.createReadStream(excelPath);

    // Create form data
    const form = new FormData();
    form.append('excelFile', fileStream, {
      filename: 'test_guests.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    console.log('Sending Excel file to /api/guests/import-excel for batch import...');

    // Create HTTP request
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/guests/import-excel',
      method: 'POST',
      headers: form.getHeaders()
    };

    const req = http.request(options, (res) => {
      console.log('Import response status:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          console.log('Import response data:', JSON.stringify(jsonData, null, 2));

          if (jsonData.success) {
            console.log('Excel batch import successful!');
            console.log('Results:', jsonData.results);
          } else {
            console.log('Excel batch import completed with issues:', jsonData.message);
            console.log('Results:', jsonData.results);
          }
        } catch (e) {
          console.log('Import response (non-JSON):', data);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Import request failed:', e.message);
    });

    // Pipe the form data to the request
    form.pipe(req);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testFullGuestImport();
