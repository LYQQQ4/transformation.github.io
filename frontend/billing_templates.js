(function (root, factory) {
  const exports = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }

  root.BillingTemplates = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BILLING_FIELD_KEYS = [
    "fee_detail",
    "amount",
    "tax_rate",
    "supplier",
    "exchange_rate",
    "remark",
    "billing_period",
  ];

  const BILLING_FIELD_LABELS = {
    fee_detail: "费用明细",
    amount: "金额",
    tax_rate: "税率",
    supplier: "供应商",
    exchange_rate: "汇率",
    remark: "备注",
    billing_period: "账期",
  };

  const LEGACY_BILLING_TEMPLATE_KEY = "legacy";
  const BILLING_TEMPLATE_ORDER = ["air", "dhl", "domestic", "sea", "customs"];

  const BILLING_TEMPLATE_DEFINITIONS = {
    air: {
      key: "air",
      label: "空运",
      title: "空运账单格式",
      amountLabel: "金额",
      transportKeywords: ["空运", "air"],
      businessKeywords: ["空运", "air"],
      categories: [
        { label: "提货运输费" },
        { label: "出口报关操作费" },
        { label: "空运单价/kg" },
        { label: "国际运费" },
        { label: "THC操作费" },
        { label: "清关费" },
        { label: "送货运输费" },
        { label: "其它杂费", aliases: ["其他杂费"] },
        { label: "增值服务费" },
        { label: "代垫费" },
        { label: "费用小计" },
        { label: "含税价" },
      ],
    },
    dhl: {
      key: "dhl",
      label: "DHL",
      title: "DHL账单格式",
      amountLabel: "金额",
      transportKeywords: ["dhl"],
      businessKeywords: ["dhl"],
      categories: [
        { label: "DHL公布运价" },
        { label: "折扣价" },
        { label: "其他附加费" },
        { label: "燃油附加费" },
        { label: "直接签收附加费" },
        { label: "清关费" },
        { label: "送货运输", aliases: ["送货运输费", "送货费"] },
        { label: "其它杂费", aliases: ["其他杂费"] },
        { label: "增值服务费" },
        { label: "代垫费" },
        { label: "费用小计" },
        { label: "含税价" },
      ],
    },
    domestic: {
      key: "domestic",
      label: "国内运输",
      title: "国内运输账单格式",
      amountLabel: "金额",
      transportKeywords: ["国内运输", "国内", "陆运", "汽运", "卡车"],
      businessKeywords: ["国内运输", "国内", "陆运", "汽运"],
      categories: [
        { label: "提货费", aliases: ["提货运输费"] },
        { label: "在途运费" },
        { label: "送货费", aliases: ["送货运输费", "送货运输"] },
        { label: "清关费" },
        { label: "其它杂费", aliases: ["其他杂费"] },
        { label: "增值服务费" },
        { label: "代垫费" },
        { label: "费用小计" },
        { label: "含税价" },
      ],
    },
    sea: {
      key: "sea",
      label: "海运",
      title: "海运运输账单格式",
      amountLabel: "未税金额",
      transportKeywords: ["海运", "sea", "ocean"],
      businessKeywords: ["海运", "sea", "ocean"],
      categories: [
        { label: "提货费", aliases: ["提货运输费"] },
        { label: "出口报关、THC操作" },
        { label: "海运单价/cbm" },
        { label: "海运费" },
        { label: "国内THC/港杂费" },
        { label: "清关费" },
        { label: "送货费", aliases: ["送货运输费", "送货运输"] },
        { label: "其它杂费", aliases: ["其他杂费"] },
        { label: "增值服务费" },
        { label: "代垫费" },
        { label: "费用小计" },
        { label: "含税价" },
      ],
    },
    customs: {
      key: "customs",
      label: "清关",
      title: "清关账单格式",
      amountLabel: "未税金额",
      transportKeywords: ["清关", "customs"],
      businessKeywords: ["清关", "customs"],
      categories: [
        { label: "提货费", aliases: ["提货运输费"] },
        { label: "清关费" },
        { label: "送货费", aliases: ["送货运输费", "送货运输"] },
        { label: "其它杂费", aliases: ["其他杂费"] },
        { label: "增值服务费" },
        { label: "代垫费" },
        { label: "费用小计" },
        { label: "含税价" },
      ],
    },
  };

  const LEGACY_BILLING_TEMPLATE = {
    key: LEGACY_BILLING_TEMPLATE_KEY,
    label: "历史通用",
    title: "历史通用账单格式",
    amountLabel: "金额",
    categories: [
      { label: "提货运输费" },
      { label: "出口报关操作费" },
      { label: "空运单价/kg" },
      { label: "国际运费" },
      { label: "THC操作费" },
      { label: "清关费" },
      { label: "送货运输费", aliases: ["送货运输", "送货费"] },
      { label: "其他杂费", aliases: ["其它杂费"] },
      { label: "增值服务费" },
      { label: "代垫费" },
      { label: "费用小计" },
      { label: "含税价" },
    ],
  };

  function normalizeText(value) {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }

  function normalizeLookupKey(value) {
    return normalizeText(value).replace(/\s+/g, "").toLowerCase();
  }

  function sanitizeItemValue(value) {
    return normalizeText(value);
  }

  function createEmptyBillingItem(category) {
    return BILLING_FIELD_KEYS.reduce(
      (item, fieldKey) => {
        item[fieldKey] = "";
        return item;
      },
      { category: normalizeText(category) }
    );
  }

  function normalizeBillingItem(item, category) {
    const normalized = createEmptyBillingItem(category);

    BILLING_FIELD_KEYS.forEach((fieldKey) => {
      normalized[fieldKey] = sanitizeItemValue(item?.[fieldKey]);
    });

    return normalized;
  }

  function isBillingItemFilled(item) {
    return BILLING_FIELD_KEYS.some((fieldKey) => normalizeText(item?.[fieldKey]) !== "");
  }

  function hasFilledBillingItems(items) {
    return (Array.isArray(items) ? items : []).some(isBillingItemFilled);
  }

  function getBillingTemplate(templateKey) {
    return BILLING_TEMPLATE_DEFINITIONS[templateKey] || LEGACY_BILLING_TEMPLATE;
  }

  function getBillingFieldDefinitions(templateKey) {
    const template = getBillingTemplate(templateKey);

    return BILLING_FIELD_KEYS.map((fieldKey) => ({
      key: fieldKey,
      label: fieldKey === "amount" ? template.amountLabel : BILLING_FIELD_LABELS[fieldKey],
    }));
  }

  function buildTemplateCategoryAliasMap(templateKey) {
    const template = getBillingTemplate(templateKey);
    const aliasMap = new Map();

    template.categories.forEach((categoryDefinition) => {
      const canonicalLabel = normalizeText(categoryDefinition.label);
      const aliasValues = [categoryDefinition.label].concat(categoryDefinition.aliases || []);

      aliasValues.forEach((alias) => {
        aliasMap.set(normalizeLookupKey(alias), canonicalLabel);
      });
    });

    return aliasMap;
  }

  function buildItemLookup(items) {
    const lookup = new Map();

    (Array.isArray(items) ? items : []).forEach((item) => {
      const rawCategory = normalizeText(item?.category || item?.fee_category);
      if (!rawCategory) {
        return;
      }

      const lookupKey = normalizeLookupKey(rawCategory);
      if (!lookup.has(lookupKey)) {
        lookup.set(lookupKey, []);
      }

      lookup.get(lookupKey).push(item || {});
    });

    return lookup;
  }

  function mergeItems(items, category) {
    if (!Array.isArray(items) || items.length === 0) {
      return createEmptyBillingItem(category);
    }

    return items.reduce((merged, current) => {
      const normalized = normalizeBillingItem(current, category);

      BILLING_FIELD_KEYS.forEach((fieldKey) => {
        if (merged[fieldKey]) {
          return;
        }

        merged[fieldKey] = normalized[fieldKey];
      });

      return merged;
    }, createEmptyBillingItem(category));
  }

  function normalizeBillingItems(items, templateKey, options) {
    const normalizedOptions = options || {};
    const preserveUnknown = normalizedOptions.preserveUnknown === true;
    const template = getBillingTemplate(templateKey);
    const aliasMap = buildTemplateCategoryAliasMap(templateKey);
    const itemLookup = buildItemLookup(items);
    const consumedKeys = new Set();
    const normalizedItems = template.categories.map((categoryDefinition) => {
      const canonicalLabel = normalizeText(categoryDefinition.label);
      const matchingItems = [];

      [categoryDefinition.label].concat(categoryDefinition.aliases || []).forEach((alias) => {
        const lookupKey = normalizeLookupKey(alias);
        if (!lookupKey || !itemLookup.has(lookupKey)) {
          return;
        }

        consumedKeys.add(lookupKey);
        matchingItems.push(...itemLookup.get(lookupKey));
      });

      return mergeItems(matchingItems, canonicalLabel);
    });

    if (!preserveUnknown) {
      return normalizedItems;
    }

    itemLookup.forEach((matchedItems, lookupKey) => {
      if (consumedKeys.has(lookupKey)) {
        return;
      }

      const fallbackCategory = normalizeText(matchedItems[0]?.category || matchedItems[0]?.fee_category);
      if (!fallbackCategory) {
        return;
      }

      const canonicalCategory = aliasMap.get(lookupKey) || fallbackCategory;
      normalizedItems.push(mergeItems(matchedItems, canonicalCategory));
    });

    return normalizedItems;
  }

  function resolveTransportTemplateKey(value) {
    const normalizedValue = normalizeLookupKey(value);
    if (!normalizedValue) {
      return "";
    }

    if (normalizedValue.includes("dhl")) {
      return "dhl";
    }

    if (normalizedValue.includes("清关") || normalizedValue.includes("customs")) {
      return "customs";
    }

    if (normalizedValue.includes("海运") || normalizedValue.includes("sea") || normalizedValue.includes("ocean")) {
      return "sea";
    }

    if (
      normalizedValue.includes("国内") ||
      normalizedValue.includes("陆运") ||
      normalizedValue.includes("汽运") ||
      normalizedValue.includes("卡车")
    ) {
      return "domestic";
    }

    if (normalizedValue.includes("空运") || normalizedValue.includes("air")) {
      return "air";
    }

    return "";
  }

  function getFilledItemCategorySet(items) {
    const filledCategories = new Set();

    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!isBillingItemFilled(item)) {
        return;
      }

      const category = normalizeText(item?.category || item?.fee_category);
      if (category) {
        filledCategories.add(category);
      }
    });

    return filledCategories;
  }

  function getTemplateKeysForCategory(category) {
    const lookupKey = normalizeLookupKey(category);
    if (!lookupKey) {
      return [];
    }

    return BILLING_TEMPLATE_ORDER.filter((templateKey) =>
      buildTemplateCategoryAliasMap(templateKey).has(lookupKey)
    );
  }

  function isTemplateCompatibleWithItems(templateKey, costItems, billingItems) {
    if (templateKey === LEGACY_BILLING_TEMPLATE_KEY) {
      return true;
    }

    const aliasMap = buildTemplateCategoryAliasMap(templateKey);
    const combinedCategories = new Set([
      ...getFilledItemCategorySet(costItems),
      ...getFilledItemCategorySet(billingItems),
    ]);

    if (combinedCategories.size === 0) {
      return true;
    }

    for (const category of combinedCategories) {
      if (!aliasMap.has(normalizeLookupKey(category))) {
        return false;
      }
    }

    return true;
  }

  function inferTemplateKeyFromItems(costItems, billingItems) {
    const combinedCategories = new Set([
      ...getFilledItemCategorySet(costItems),
      ...getFilledItemCategorySet(billingItems),
    ]);

    if (combinedCategories.size === 0) {
      return "";
    }

    const categoryTemplateLists = Array.from(combinedCategories, (category) =>
      getTemplateKeysForCategory(category)
    );
    const uniqueTemplateKeys = new Set(
      categoryTemplateLists.filter((templates) => templates.length === 1).map((templates) => templates[0])
    );

    if (uniqueTemplateKeys.size === 1) {
      return Array.from(uniqueTemplateKeys)[0];
    }

    const fullMatches = BILLING_TEMPLATE_ORDER.filter((templateKey) =>
      categoryTemplateLists.every((templates) => templates.includes(templateKey))
    );

    if (fullMatches.length === 1) {
      return fullMatches[0];
    }

    return "";
  }

  function resolveBillingTemplate(record, options) {
    const normalizedRecord = record || {};
    const normalizedOptions = options || {};
    const forcedTemplateKey = BILLING_TEMPLATE_DEFINITIONS[normalizedOptions.forceTemplateKey] ||
      normalizedOptions.forceTemplateKey === LEGACY_BILLING_TEMPLATE_KEY
      ? normalizedOptions.forceTemplateKey
      : "";
    const preferredTemplateKey = BILLING_TEMPLATE_DEFINITIONS[normalizedOptions.preferredTemplateKey]
      ? normalizedOptions.preferredTemplateKey
      : "";
    const costItems = Array.isArray(normalizedRecord.cost_items) ? normalizedRecord.cost_items : [];
    const billingItems = Array.isArray(normalizedRecord.billing_items) ? normalizedRecord.billing_items : [];

    if (forcedTemplateKey) {
      return {
        key: forcedTemplateKey,
        template: getBillingTemplate(forcedTemplateKey),
        source: "forced",
      };
    }

    const transportTemplateKey = resolveTransportTemplateKey(normalizedRecord.transport_mode);
    if (
      transportTemplateKey &&
      isTemplateCompatibleWithItems(transportTemplateKey, costItems, billingItems)
    ) {
      return {
        key: transportTemplateKey,
        template: getBillingTemplate(transportTemplateKey),
        source: "transport_mode",
      };
    }

    const businessTemplateKey = resolveTransportTemplateKey(normalizedRecord.business_type);
    if (
      businessTemplateKey &&
      isTemplateCompatibleWithItems(businessTemplateKey, costItems, billingItems)
    ) {
      return {
        key: businessTemplateKey,
        template: getBillingTemplate(businessTemplateKey),
        source: "business_type",
      };
    }

    const itemTemplateKey = inferTemplateKeyFromItems(costItems, billingItems);
    if (itemTemplateKey) {
      return {
        key: itemTemplateKey,
        template: getBillingTemplate(itemTemplateKey),
        source: "items",
      };
    }

    if (
      preferredTemplateKey &&
      isTemplateCompatibleWithItems(preferredTemplateKey, costItems, billingItems)
    ) {
      return {
        key: preferredTemplateKey,
        template: getBillingTemplate(preferredTemplateKey),
        source: "preferred",
      };
    }

    if (transportTemplateKey || businessTemplateKey || preferredTemplateKey) {
      return {
        key: LEGACY_BILLING_TEMPLATE_KEY,
        template: LEGACY_BILLING_TEMPLATE,
        source: "legacy_fallback",
      };
    }

    return {
      key: LEGACY_BILLING_TEMPLATE_KEY,
      template: LEGACY_BILLING_TEMPLATE,
      source: hasFilledBillingItems(costItems) || hasFilledBillingItems(billingItems)
        ? "legacy_items"
        : "legacy_empty",
    };
  }

  return {
    BILLING_FIELD_KEYS,
    BILLING_TEMPLATE_ORDER,
    BILLING_TEMPLATE_DEFINITIONS,
    LEGACY_BILLING_TEMPLATE,
    LEGACY_BILLING_TEMPLATE_KEY,
    createEmptyBillingItem,
    getBillingFieldDefinitions,
    getBillingTemplate,
    hasFilledBillingItems,
    inferTemplateKeyFromItems,
    isBillingItemFilled,
    isTemplateCompatibleWithItems,
    normalizeBillingItem,
    normalizeBillingItems,
    normalizeLookupKey,
    normalizeText,
    resolveBillingTemplate,
    resolveTransportTemplateKey,
  };
});
