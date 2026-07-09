function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeCountryCode(value, fallback = "ch") {
  const code = normalizeText(value).toLowerCase().replace(/[^a-z]/g, "");
  return code.length >= 2 ? code.slice(0, 2) : fallback;
}

function inferCountryCode(...values) {
  const text = values.map((value) => normalizeText(value).toLowerCase()).filter(Boolean).join(" ");
  if (!text) {
    return "ch";
  }

  const prefixMatch = text.match(/\b([a-z]{2})\d{2,}\b/);
  if (prefixMatch) {
    return normalizeCountryCode(prefixMatch[1], "ch");
  }

  const rules = [
    { code: "us", patterns: ["usa", "united states", "america", "us "] },
    { code: "uk", patterns: ["united kingdom", "england", "britain"] },
    { code: "de", patterns: ["germany", "deutschland"] },
    { code: "fr", patterns: ["france"] },
    { code: "jp", patterns: ["japan"] },
    { code: "kr", patterns: ["korea"] },
    { code: "hk", patterns: ["hong kong"] },
    { code: "tw", patterns: ["taiwan"] },
    { code: "ch", patterns: ["china", "shenzhen", "guangzhou", "shanghai", "beijing", "yiwu"] },
  ];

  for (const rule of rules) {
    if (rule.patterns.some((pattern) => text.includes(pattern))) {
      return rule.code;
    }
  }

  return "ch";
}

function validateUserProfileId(id) {
  return /^[a-z]{2}\d{3,}$/i.test(normalizeText(id));
}

function normalizeDedupeToken(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizePhoneForDedupe(value) {
  return normalizeText(value).replace(/[^\da-z+]/gi, "");
}

function buildDedupeKey(profile) {
  const companyName = normalizeDedupeToken(profile.company_name);
  const address = normalizeDedupeToken(profile.address);
  const contactName = normalizeDedupeToken(profile.contact_name);
  const phone = normalizePhoneForDedupe(profile.phone);
  const anchor = companyName || address;

  if (!anchor || (!contactName && !phone)) {
    return null;
  }

  return `${anchor}|${contactName}|${phone}`.slice(0, 255);
}

function pickPreferredValue(currentValue, nextValue) {
  const current = normalizeText(currentValue);
  const next = normalizeText(nextValue);

  if (!current) {
    return next || null;
  }
  if (!next) {
    return current;
  }
  return next.length > current.length ? next : current;
}

function mergeSourceTypes(...values) {
  const set = new Set(values.map((value) => normalizeText(value)).filter(Boolean));
  if (set.has("sender") && set.has("customer")) {
    return "both";
  }
  if (set.has("both")) {
    return "both";
  }
  if (set.size === 1) {
    return [...set][0];
  }
  if (set.has("manual") && set.size === 2) {
    return [...set].find((value) => value !== "manual") || "manual";
  }
  return set.size > 0 ? "mixed" : "manual";
}

function mergeUserProfiles(baseProfile, incomingProfile) {
  const merged = {
    ...baseProfile,
    ...incomingProfile,
    id: normalizeText(baseProfile.id || incomingProfile.id) || null,
    country_code: normalizeCountryCode(
      incomingProfile.country_code || baseProfile.country_code || inferCountryCode(
        incomingProfile.id,
        baseProfile.id,
        incomingProfile.address,
        baseProfile.address
      )
    ),
    sequence_no: incomingProfile.sequence_no || baseProfile.sequence_no || null,
    company_name: pickPreferredValue(baseProfile.company_name, incomingProfile.company_name),
    address: pickPreferredValue(baseProfile.address, incomingProfile.address),
    contact_name: pickPreferredValue(baseProfile.contact_name, incomingProfile.contact_name),
    phone: pickPreferredValue(baseProfile.phone, incomingProfile.phone),
    email: pickPreferredValue(baseProfile.email, incomingProfile.email),
    remark: pickPreferredValue(baseProfile.remark, incomingProfile.remark),
    legacy_sender_id: pickPreferredValue(baseProfile.legacy_sender_id, incomingProfile.legacy_sender_id),
    legacy_customer_id: pickPreferredValue(baseProfile.legacy_customer_id, incomingProfile.legacy_customer_id),
    source_type: mergeSourceTypes(baseProfile.source_type, incomingProfile.source_type),
    migration_batch: pickPreferredValue(baseProfile.migration_batch, incomingProfile.migration_batch),
  };

  merged.dedupe_key = buildDedupeKey(merged);
  return merged;
}

function normalizeUserProfilePayload(raw = {}) {
  const id = normalizeText(raw.id);
  const countryCode = normalizeCountryCode(
    raw.country_code || (validateUserProfileId(id) ? id.slice(0, 2) : ""),
    inferCountryCode(id, raw.company_name, raw.address, raw.contact_name, raw.phone)
  );

  const profile = {
    id: id || null,
    country_code: countryCode,
    company_name: normalizeText(raw.company_name) || null,
    address: normalizeText(raw.address) || null,
    contact_name: normalizeText(raw.contact_name) || null,
    phone: normalizePhone(raw.phone) || null,
    email: normalizeEmail(raw.email) || null,
    remark: normalizeText(raw.remark) || null,
    source_type: normalizeText(raw.source_type) || "manual",
    legacy_sender_id: normalizeText(raw.legacy_sender_id) || null,
    legacy_customer_id: normalizeText(raw.legacy_customer_id) || null,
    migration_batch: normalizeText(raw.migration_batch) || null,
  };

  profile.dedupe_key = buildDedupeKey(profile);
  return profile;
}

function mapSenderRecordToProfile(row, batchId = null) {
  return normalizeUserProfilePayload({
    country_code: inferCountryCode(row.sender_id, row.shipping_address, row.sender_name),
    address: row.shipping_address,
    contact_name: row.sender_name,
    phone: row.sender_phone,
    source_type: "sender",
    legacy_sender_id: row.sender_id,
    migration_batch: batchId,
  });
}

function mapCustomerRecordToProfile(row, batchId = null) {
  return normalizeUserProfilePayload({
    country_code: inferCountryCode(row.customer_id, row.delivery_address, row.receiver_name),
    address: row.delivery_address,
    contact_name: row.receiver_name,
    phone: row.receiver_phone,
    source_type: "customer",
    legacy_customer_id: row.customer_id,
    migration_batch: batchId,
  });
}

function normalizeUserProfileExcelRow(raw = {}) {
  return normalizeUserProfilePayload({
    id: raw["用户ID"] ?? raw.id,
    country_code: raw["国家"] ?? raw["国家代码"] ?? raw.country_code,
    company_name: raw["公司名称"] ?? raw.company_name,
    address: raw["地址"] ?? raw.address,
    contact_name: raw["联系人姓名"] ?? raw["联系人"] ?? raw.contact_name,
    phone: raw["电话"] ?? raw["手机号"] ?? raw.phone,
    email: raw["邮箱"] ?? raw.email,
    remark: raw["备注"] ?? raw.remark,
    source_type: "manual",
  });
}

module.exports = {
  buildDedupeKey,
  inferCountryCode,
  mapCustomerRecordToProfile,
  mapSenderRecordToProfile,
  mergeUserProfiles,
  normalizeCountryCode,
  normalizeText,
  normalizeUserProfileExcelRow,
  normalizeUserProfilePayload,
  validateUserProfileId,
};
