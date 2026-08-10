const assert = require("assert");
const path = require("path");
const XLSX = require("xlsx");
const billingTemplates = require("../frontend/billing_templates");

const workbookPath = path.join(__dirname, "..", "账单格式.xlsx");
const workbook = XLSX.readFile(workbookPath);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
  header: 1,
  defval: "",
});

const templateDefinitions = billingTemplates.BILLING_TEMPLATE_ORDER.map((key) =>
  billingTemplates.getBillingTemplate(key)
);
const titleToKey = new Map(templateDefinitions.map((template) => [template.title, template.key]));
const parsedTemplates = new Map();

for (let index = 0; index < rows.length; index += 1) {
  const title = String(rows[index]?.[0] || "").trim();
  if (!titleToKey.has(title)) {
    continue;
  }

  const templateKey = titleToKey.get(title);
  const template = billingTemplates.getBillingTemplate(templateKey);
  const header = (rows[index + 1] || []).slice(1, 8).map((value) => String(value).trim());
  const expectedHeader = billingTemplates.getBillingFieldDefinitions(templateKey).map((field) => field.label);
  assert.deepStrictEqual(header, expectedHeader, `${templateKey} header does not match workbook`);

  const categories = [];
  let rowIndex = index + 2;
  while (rowIndex < rows.length) {
    const category = String(rows[rowIndex]?.[0] || "").trim();
    if (!category) {
      break;
    }
    if (titleToKey.has(category)) {
      break;
    }
    categories.push(category);
    rowIndex += 1;
  }

  assert.deepStrictEqual(
    categories,
    template.categories.map((category) => category.label),
    `${templateKey} categories do not match workbook`
  );
  parsedTemplates.set(templateKey, true);
}

assert.deepStrictEqual(
  [...parsedTemplates.keys()].sort(),
  billingTemplates.BILLING_TEMPLATE_ORDER.slice().sort(),
  "workbook should contain exactly the five configured billing templates"
);

const transportCases = [
  ["空运", "air"],
  ["DHL", "dhl"],
  ["国内运输", "domestic"],
  ["陆运", "domestic"],
  ["海运", "sea"],
  ["清关", "customs"],
];

transportCases.forEach(([transportMode, expectedKey]) => {
  const resolved = billingTemplates.resolveBillingTemplate({ transport_mode: transportMode });
  assert.strictEqual(resolved.key, expectedKey, `${transportMode} should resolve to ${expectedKey}`);
});

assert.strictEqual(
  billingTemplates.getBillingTemplate("sea").amountLabel,
  "未税金额",
  "sea amount header should be 未税金额"
);
assert.strictEqual(
  billingTemplates.getBillingTemplate("customs").amountLabel,
  "未税金额",
  "customs amount header should be 未税金额"
);

const forcedSea = billingTemplates.resolveBillingTemplate(
  {
    transport_mode: "海运",
    cost_items: [{ category: "空运单价/kg", amount: "100" }],
  },
  { forceTemplateKey: "sea" }
);
assert.strictEqual(forcedSea.key, "sea", "explicit template selection should win");
assert.deepStrictEqual(
  billingTemplates.normalizeBillingItems(
    [{ category: "空运单价/kg", amount: "100" }],
    "sea"
  ).find((item) => item.category === "空运单价/kg"),
  undefined,
  "fields outside the selected template must not be persisted"
);

console.log("billing template validation passed");
