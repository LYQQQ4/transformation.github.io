(function (root, factory) {
  const exports = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }

  root.OrderSummaryFields = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ORDER_SUMMARY_EMPTY_VALUE_TEXT = "\u8be5\u9879\u672a\u586b";

  function normalizeText(value) {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }

  function parseFeeItems(value) {
    if (Array.isArray(value)) {
      return value;
    }

    const text = normalizeText(value);
    if (!text) {
      return [];
    }

    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function parseAmount(value) {
    const text = normalizeText(value).replace(/,/g, "");
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(text)) {
      return null;
    }

    const amount = Number(text);
    return Number.isFinite(amount) ? amount : null;
  }

  function formatAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return "";
    }

    return String(Math.round((amount + Number.EPSILON) * 100) / 100);
  }

  function sumFeeItemAmounts(value) {
    const amounts = parseFeeItems(value)
      .map((item) => parseAmount(item?.amount))
      .filter((amount) => amount !== null);

    if (!amounts.length) {
      return "";
    }

    return formatAmount(amounts.reduce((total, amount) => total + amount, 0));
  }

  function deriveBillingPeriod(row = {}) {
    const directValue = normalizeText(row.billing_period_raw || row.billing_period);
    if (directValue) {
      return directValue;
    }

    const periods = [];
    const seen = new Set();
    parseFeeItems(row.billing_items_raw || row.billing_items).forEach((item) => {
      const period = normalizeText(item?.billing_period);
      if (period && !seen.has(period)) {
        seen.add(period);
        periods.push(period);
      }
    });

    return periods.join(" / ");
  }

  function getOrderSummaryFieldValue(row = {}, fieldKey) {
    const values = {
      serial_number: row.serial_number || row.id,
      company_name: row.company_name,
      orderer: row.orderer,
      business_type: row.business_type,
      sender_id: row.sender_id,
      customer_id: row.customer_id,
      receive_date: row.receive_date,
      origin: row.order_origin || row.origin,
      destination: row.order_destination || row.destination,
      trade_term: row.trade_term,
      product_name: row.order_product_name || row.product_name,
      transport_mode: row.transport_mode,
      tracking_number: row.tracking_number,
      pieces_total: row.pieces_total,
      cost_total: row.cost_total ?? sumFeeItemAmounts(row.cost_items_raw || row.cost_items),
      sales_total: row.sales_total ?? sumFeeItemAmounts(row.billing_items_raw || row.billing_items),
      billing_period: deriveBillingPeriod(row),
    };

    return values[fieldKey] ?? "";
  }

  function formatDate(value) {
    const text = normalizeText(value);
    const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/u);
    if (!match) {
      return text;
    }

    return `${match[1]}/${String(match[2]).padStart(2, "0")}/${String(match[3]).padStart(2, "0")}`;
  }

  const ORDER_SUMMARY_FIELD_DEFINITIONS = [
    { key: "serial_number", label: "\u6d41\u6c34\u53f7" },
    { key: "company_name", label: "\u516c\u53f8\u540d\u79f0" },
    { key: "orderer", label: "\u6307\u4ee4\u4eba" },
    { key: "business_type", label: "\u4e1a\u52a1\u7c7b\u578b" },
    { key: "sender_id", label: "\u53d1\u4ef6\u4ebaID" },
    { key: "customer_id", label: "\u6536\u4ef6\u4ebaID" },
    { key: "receive_date", label: "\u63a5\u53d7\u6307\u4ee4\u65e5\u671f", format: "date" },
    { key: "origin", label: "\u8d77\u59cb\u5730" },
    { key: "destination", label: "\u76ee\u7684\u5730" },
    { key: "trade_term", label: "\u8d38\u6613\u672f\u8bed" },
    { key: "product_name", label: "\u8d27\u7269\u54c1\u540d" },
    { key: "transport_mode", label: "\u8fd0\u8f93\u65b9\u5f0f" },
    { key: "tracking_number", label: "\u8fd0\u5355\u53f7" },
    { key: "pieces_total", label: "\u4ef6\u6570" },
    { key: "cost_total", label: "\u6210\u672c", format: "amount" },
    { key: "sales_total", label: "\u9500\u552e", format: "amount" },
    { key: "billing_period", label: "\u8d26\u671f" },
  ].map((field) => ({
    ...field,
    outputKey: field.key,
    section: "order_summary",
    getValue: (row) => getOrderSummaryFieldValue(row, field.key),
  }));

  function formatOrderSummaryValue(fieldKey, value, options = {}) {
    const emptyValueText = normalizeText(options.emptyValueText) || ORDER_SUMMARY_EMPTY_VALUE_TEXT;
    const field = ORDER_SUMMARY_FIELD_DEFINITIONS.find((item) => item.key === fieldKey);
    const text = normalizeText(value);

    if (!text) {
      return emptyValueText;
    }

    if (field?.format === "date") {
      return formatDate(text);
    }

    if (field?.format === "amount") {
      return formatAmount(text) || text;
    }

    return text;
  }

  function enrichOrderSummaryFields(row = {}) {
    return {
      ...row,
      cost_total: getOrderSummaryFieldValue(row, "cost_total"),
      sales_total: getOrderSummaryFieldValue(row, "sales_total"),
      billing_period: getOrderSummaryFieldValue(row, "billing_period"),
    };
  }

  return {
    ORDER_SUMMARY_EMPTY_VALUE_TEXT,
    ORDER_SUMMARY_FIELD_DEFINITIONS,
    deriveBillingPeriod,
    enrichOrderSummaryFields,
    formatOrderSummaryValue,
    getOrderSummaryFieldValue,
    parseFeeItems,
    sumFeeItemAmounts,
  };
});
