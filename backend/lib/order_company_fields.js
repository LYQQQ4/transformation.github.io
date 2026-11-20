async function hydrateOrderCompanyFields(rows, userDb) {
  if (!userDb || !rows.length) {
    return rows;
  }

  const ids = [...new Set(rows.flatMap((row) => [row.sender_id, row.customer_id]
    .map((id) => String(id || "").trim())
    .filter(Boolean)))];
  if (!ids.length) {
    return rows;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const [profiles] = await userDb.execute(
    `SELECT id, legacy_sender_id, legacy_customer_id, company_name
     FROM user_profiles
     WHERE id IN (${placeholders})
        OR legacy_sender_id IN (${placeholders})
        OR legacy_customer_id IN (${placeholders})`,
    [...ids, ...ids, ...ids]
  );
  const companies = new Map();
  profiles.forEach((profile) => {
    const company = String(profile.company_name || "").trim();
    [profile.id, profile.legacy_sender_id, profile.legacy_customer_id]
      .filter(Boolean)
      .forEach((id) => companies.set(String(id).trim(), company));
  });

  return rows.map((row) => ({
    ...row,
    sender_company: companies.get(String(row.sender_id || "").trim()) || row.sender_company || "",
    receiver_company: companies.get(String(row.customer_id || "").trim()) || row.receiver_company || "",
  }));
}

module.exports = { hydrateOrderCompanyFields };
