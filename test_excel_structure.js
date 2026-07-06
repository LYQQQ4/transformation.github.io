const XLSX = require('xlsx');
const fs = require('fs');

// Test Excel file structure
function testExcelStructure() {
  console.log('Testing Excel file structure...');

  try {
    const excelPath = 'c:/Users/lin/Desktop/test_guests.xlsx';
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    console.log('Sheet name:', sheetName);
    console.log('Worksheet range:', worksheet['!ref']);

    // Get data with headers as array
    const jsonDataArray = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log('Data with array headers (first 3 rows):');
    for (let i = 0; i < Math.min(3, jsonDataArray.length); i++) {
      console.log(`Row ${i}:`, jsonDataArray[i]);
    }

    // Get data with headers as object
    const jsonDataObject = XLSX.utils.sheet_to_json(worksheet);
    console.log('\nData with object headers (first 2 rows):');
    for (let i = 0; i < Math.min(2, jsonDataObject.length); i++) {
      console.log(`Row ${i}:`, JSON.stringify(jsonDataObject[i], null, 2));
    }

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testExcelStructure();
