const fs = require('fs');
const http = require('http');
const FormData = require('form-data');

// Test Excel import functionality using http module
function testExcelImport() {
  console.log('Testing Excel import functionality...');

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

    console.log('Sending Excel file to /api/guests/parse-excel...');

    // Create HTTP request
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/guests/parse-excel',
      method: 'POST',
      headers: form.getHeaders()
    };

    const req = http.request(options, (res) => {
      console.log('Parse response status:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          console.log('Parse response data:', JSON.stringify(jsonData, null, 2));

          if (jsonData.success) {
            console.log('Excel parsing successful!');
          } else {
            console.log('Excel parsing failed:', jsonData.error);
          }
        } catch (e) {
          console.log('Parse response (non-JSON):', data);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request failed:', e.message);
    });

    // Pipe the form data to the request
    form.pipe(req);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testExcelImport();
