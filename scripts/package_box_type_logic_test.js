const assert = require("assert");

const {
  normalizePackageRow,
  validatePackageExcelData,
  DEFAULT_BOX_TYPE_ID,
} = require("../backend/routes/packages")._test;

const boxA = {
  box_type_id: "BOX-A",
  package_type: "Carton A",
  length_cm: 10,
  width_cm: 20,
  height_cm: 30,
  volume_cm3: 0.006,
};

const boxB = {
  box_type_id: "BOX-B",
  package_type: "Carton B",
  length_cm: 40,
  width_cm: 50,
  height_cm: 60,
  volume_cm3: 0.12,
};

const defaultBox = {
  box_type_id: DEFAULT_BOX_TYPE_ID,
  package_type: "Default",
  length_cm: null,
  width_cm: null,
  height_cm: null,
  volume_cm3: null,
};

const boxTypeMap = new Map([
  [defaultBox.box_type_id, defaultBox],
  [boxA.box_type_id, boxA],
  [boxB.box_type_id, boxB],
]);

const importedById = normalizePackageRow({ box_type_id: "BOX-A" }, 1, boxTypeMap);
assert.strictEqual(importedById.box_type_id, "BOX-A");
assert.strictEqual(importedById.package_type, "Carton A");
assert.strictEqual(importedById.length, 10);
assert.strictEqual(importedById.width, 20);
assert.strictEqual(importedById.height, 30);

const editedAfterImport = normalizePackageRow(
  {
    box_type_id: "BOX-A",
    package_type: "Carton A",
    length: 11,
    width: 20,
    height: 30,
  },
  1,
  boxTypeMap
);
assert.strictEqual(editedAfterImport.box_type_id, null);
assert.strictEqual(editedAfterImport.length, 11);

const uniquelyMatched = normalizePackageRow(
  { package_type: "Carton B", length: 40, width: 50, height: 60 },
  1,
  boxTypeMap
);
assert.strictEqual(uniquelyMatched.box_type_id, "BOX-B");

const duplicateMap = new Map([
  ["BOX-A", boxA],
  ["BOX-A-DUP", { ...boxA, box_type_id: "BOX-A-DUP" }],
]);
const duplicateMatch = normalizePackageRow(
  { package_type: "Carton A", length: 10, width: 20, height: 30 },
  1,
  duplicateMap
);
assert.strictEqual(duplicateMatch.box_type_id, null);

const excelById = validatePackageExcelData({ serial_number: "SN001", box_type_id: "BOX-A" }, boxTypeMap);
assert.strictEqual(excelById.isValid, true);
assert.strictEqual(excelById.data.box_type_id, "BOX-A");
assert.strictEqual(excelById.data.package_type, "Carton A");

const excelUnknownId = validatePackageExcelData({ serial_number: "SN002", box_type_id: "MISSING" }, boxTypeMap);
assert.strictEqual(excelUnknownId.isValid, false);
assert.ok(excelUnknownId.errors.some((error) => error.includes("MISSING")));

console.log("package box type logic tests passed");
