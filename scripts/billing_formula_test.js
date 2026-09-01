const assert = require("assert");
const billingFormula = require("../frontend/billing_formula");

function expectNormalized(fieldKey, rawValue, expectedValue, expectedComputed = true) {
  const result = billingFormula.normalizeBillingFieldValue(fieldKey, rawValue);
  assert.strictEqual(result.ok, true, `${fieldKey} should normalize: ${rawValue}`);
  assert.strictEqual(result.value, expectedValue, `${fieldKey} normalized value mismatch for ${rawValue}`);
  if (expectedComputed) {
    assert.ok(result.kind === "formula" || result.kind === "numeric", `${fieldKey} should be formula/numeric`);
  }
}

expectNormalized("amount", "100 + 50", "150");
expectNormalized("amount", "200 * 2", "400");
expectNormalized("amount", "500 - 120", "380");
expectNormalized("amount", "800 / 4", "200");
expectNormalized("amount", "0.1 + 0.2", "0.3");
expectNormalized("amount", "(100 + 20) * 3", "360");
expectNormalized("tax_rate", "13 / 100", "0.13");
expectNormalized("exchange_rate", "7.12345", "7.1235");
expectNormalized("amount", "100", "100");

const textResult = billingFormula.normalizeBillingFieldValue("remark", "100 + 50");
assert.strictEqual(textResult.ok, true);
assert.strictEqual(textResult.value, "100 + 50");
assert.strictEqual(textResult.kind, "text");

const mixedTextResult = billingFormula.normalizeBillingFieldValue("amount", "USD 100 + 50");
assert.strictEqual(mixedTextResult.ok, true);
assert.strictEqual(mixedTextResult.value, "USD 100 + 50");
assert.strictEqual(mixedTextResult.kind, "text");

const divideByZero = billingFormula.normalizeBillingFieldValue("amount", "100/0");
assert.strictEqual(divideByZero.ok, false);
assert.strictEqual(divideByZero.error, "division_by_zero");

const dangerous = billingFormula.normalizeBillingFieldValue("amount", "alert(1)");
assert.strictEqual(dangerous.ok, true);
assert.strictEqual(dangerous.value, "alert(1)");
assert.strictEqual(dangerous.kind, "text");

const persistedItems = billingFormula.normalizeBillingItems(
  [
    { category: "测试", amount: "100 + 50", tax_rate: "13/100", exchange_rate: "7 + 0.1" }
  ],
  "legacy",
  (items) => items
);
assert.deepStrictEqual(persistedItems, [
  { category: "测试", amount: "150", tax_rate: "0.13", exchange_rate: "7.1" }
]);

assert.throws(() => {
  billingFormula.normalizeBillingItems(
    [{ category: "测试", amount: "100/0" }],
    "legacy",
    (items) => items
  );
}, /amount:division_by_zero/u);

const looseItems = billingFormula.normalizeBillingItems(
  [{ category: "测试", amount: "100/0" }],
  "legacy",
  (items) => items,
  { strict: false }
);
assert.deepStrictEqual(looseItems, [{ category: "测试", amount: "100/0", tax_rate: "", exchange_rate: "" }]);

console.log("billing formula validation passed");
