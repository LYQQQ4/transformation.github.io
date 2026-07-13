const ORDER_IMPORT_FIELDS = [
  {
    key: "company_name",
    label: "公司名称",
    aliases: ["公司抬头", "公司名称"],
    formId: "companyName",
    required: true,
    allowAutoFillFromProfile: true,
  },
  {
    key: "orderer",
    label: "指令人",
    aliases: ["指令人"],
    formId: "orderer",
    required: true,
  },
  {
    key: "receive_date",
    label: "接收指令日期",
    aliases: ["接收指令日期", "接收日期", "指令日期", "日期"],
    formId: "receiveDate",
    required: true,
  },
  {
    key: "business_type",
    label: "业务类型",
    aliases: ["业务类型"],
    formId: "businessType",
    required: true,
  },
  {
    key: "customer_id",
    label: "客户ID",
    aliases: ["客户ID"],
    formId: "customerId",
    required: true,
    allowAutoFillFromProfile: false,
  },
  {
    key: "sender_id",
    label: "发件人ID",
    aliases: ["发件人ID"],
    formId: "senderId",
    required: false,
    allowAutoFillFromProfile: false,
  },
  {
    key: "shipping_address",
    label: "发货地址",
    aliases: ["发货地址"],
    formId: "shippingAddress",
    required: true,
    allowAutoFillFromProfile: true,
  },
  {
    key: "sender_name",
    label: "发件人",
    aliases: ["发件人"],
    formId: "senderName",
    required: true,
    allowAutoFillFromProfile: true,
  },
  {
    key: "sender_phone",
    label: "发件人电话",
    aliases: ["发件人电话"],
    formId: "senderPhone",
    required: true,
    allowAutoFillFromProfile: true,
  },
  {
    key: "delivery_address",
    label: "收货地址",
    aliases: ["收货地址"],
    formId: "deliveryAddress",
    required: true,
    allowAutoFillFromProfile: true,
  },
  {
    key: "receiver_name",
    label: "收件人",
    aliases: ["收件人"],
    formId: "receiverName",
    required: true,
    allowAutoFillFromProfile: true,
  },
  {
    key: "receiver_phone",
    label: "收件人电话",
    aliases: ["收件人电话"],
    formId: "receiverPhone",
    required: true,
    allowAutoFillFromProfile: true,
  },
  {
    key: "origin",
    label: "始发地",
    aliases: ["始发地"],
    formId: "origin",
    required: true,
  },
  {
    key: "destination",
    label: "目的地",
    aliases: ["目的地"],
    formId: "destination",
    required: true,
  },
  {
    key: "trade_term",
    label: "贸易术语",
    aliases: ["贸易术语"],
    formId: "tradeTerm",
    required: false,
  },
  {
    key: "product_name",
    label: "货物品名",
    aliases: ["货物品名", "品名"],
    formId: "productName",
    required: false,
  },
  {
    key: "remark1",
    label: "备注1",
    aliases: ["备注1"],
    formId: "orderRemark1",
    required: false,
  },
  {
    key: "remark2",
    label: "备注2",
    aliases: ["备注2"],
    formId: "orderRemark2",
    required: false,
  },
];

function buildOrderImportFieldMapping() {
  const fieldMapping = {};
  ORDER_IMPORT_FIELDS.forEach((field) => {
    field.aliases.forEach((alias) => {
      fieldMapping[alias] = field.key;
    });
  });
  return fieldMapping;
}

function buildOrderFormFieldMapping() {
  return ORDER_IMPORT_FIELDS.reduce((mapping, field) => {
    mapping[field.key] = field.formId;
    return mapping;
  }, {});
}

function getOrderImportHeaders() {
  return ORDER_IMPORT_FIELDS.map((field) => field.label);
}

function getRequiredOrderImportFields() {
  return ORDER_IMPORT_FIELDS.filter((field) => field.required).map((field) => field.key);
}

function getPreEnrichRequiredOrderImportFields() {
  return ORDER_IMPORT_FIELDS
    .filter((field) => field.required && !field.allowAutoFillFromProfile)
    .map((field) => field.key);
}

function getPostEnrichRequiredOrderImportFields() {
  return ORDER_IMPORT_FIELDS.filter((field) => field.required).map((field) => field.key);
}

module.exports = {
  ORDER_IMPORT_FIELDS,
  buildOrderFormFieldMapping,
  buildOrderImportFieldMapping,
  getOrderImportHeaders,
  getPostEnrichRequiredOrderImportFields,
  getPreEnrichRequiredOrderImportFields,
  getRequiredOrderImportFields,
};
