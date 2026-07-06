const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";

async function request(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { status: res.status, data };
}

function assertStatus(resp, allowed, label) {
  if (!allowed.includes(resp.status)) {
    throw new Error(`${label} failed: status=${resp.status}, body=${JSON.stringify(resp.data)}`);
  }
}

(async () => {
  const ts = Date.now();
  const result = [];

  const state = {
    userId: null,
    senderId: `S${ts}`,
    customerId: `C${ts}`,
    guestId: `G${ts}`,
    productId: null,
    orderId: null,
    serialNumber: null,
  };

  const step = async (name, fn) => {
    try {
      await fn();
      result.push({ module: name, ok: true });
      console.log(`PASS - ${name}`);
    } catch (err) {
      result.push({ module: name, ok: false, error: err.message });
      console.error(`FAIL - ${name}: ${err.message}`);
    }
  };

  await step("users create/update/get", async () => {
    const createResp = await request("POST", "/api/users", {
      username: `smoke_user_${ts}`,
      password: "123456",
      role: "user",
      email: `smoke_${ts}@example.com`,
    });
    assertStatus(createResp, [200], "users create");
    state.userId = createResp.data.id;

    const updateResp = await request("PUT", `/api/users/${state.userId}`, {
      username: `smoke_user_${ts}`,
      password: "654321",
      role: "admin",
    });
    assertStatus(updateResp, [200], "users update");

    const getResp = await request("GET", `/api/users/${state.userId}`);
    assertStatus(getResp, [200], "users get");
  });

  await step("senders create/update/get", async () => {
    const createResp = await request("POST", "/api/senders", {
      sender_id: state.senderId,
      shipping_address: "Shenzhen Baoan",
      sender_name: "Smoke Sender",
      sender_phone: "13800000000",
    });
    assertStatus(createResp, [200], "senders create");

    const updateResp = await request("PUT", `/api/senders/${state.senderId}`, {
      shipping_address: "Guangzhou Tianhe",
      sender_name: "Smoke Sender 2",
      sender_phone: "13900000000",
    });
    assertStatus(updateResp, [200], "senders update");

    const getResp = await request("GET", `/api/senders/${state.senderId}`);
    assertStatus(getResp, [200], "senders get");
  });

  await step("customers create/update/get", async () => {
    const createResp = await request("POST", "/api/customers", {
      customer_id: state.customerId,
      delivery_address: "Shanghai Pudong",
      receiver_name: "Smoke Receiver",
      receiver_phone: "13700000000",
    });
    assertStatus(createResp, [200], "customers create");

    const updateResp = await request("PUT", `/api/customers/${state.customerId}`, {
      delivery_address: "Shanghai Minhang",
      receiver_name: "Smoke Receiver 2",
      receiver_phone: "13600000000",
    });
    assertStatus(updateResp, [200], "customers update");

    const getResp = await request("GET", `/api/customers/${state.customerId}`);
    assertStatus(getResp, [200], "customers get");
  });

  await step("guests create/update/get", async () => {
    const createResp = await request("POST", "/api/guests", {
      guest_id: state.guestId,
      contact_name: "Smoke Guest",
      company_cn: "测试客户公司",
      phone: "13500000000",
      email: `guest_${ts}@example.com`,
    });
    assertStatus(createResp, [200], "guests create");

    const updateResp = await request("PUT", `/api/guests/${state.guestId}`, {
      region: "华东",
      company_cn: "测试客户公司-更新",
      contact_name: "Smoke Guest 2",
      phone: "13400000000",
      email: `guest2_${ts}@example.com`,
    });
    assertStatus(updateResp, [200], "guests update");

    const getResp = await request("GET", `/api/guests/${state.guestId}`);
    assertStatus(getResp, [200], "guests get");
  });

  await step("products create/update/get", async () => {
    const createResp = await request("POST", "/api/products", {
      name_cn: "测试产品",
      description_en: "Smoke product",
      hs_code: "84713000",
      declaration_elements: "brand;model",
      origin: "CN",
      remark: "smoke",
    });
    assertStatus(createResp, [201], "products create");
    state.productId = createResp.data.product?.id;

    const updateResp = await request("PUT", `/api/products/${state.productId}`, {
      name_cn: "测试产品-更新",
      description_en: "Smoke product updated",
      hs_code: "84713000",
      declaration_elements: "brand;model;material",
      origin: "CN",
      remark: "smoke-updated",
    });
    assertStatus(updateResp, [200], "products update");

    const getResp = await request("GET", `/api/products/${state.productId}`);
    assertStatus(getResp, [200], "products get");
  });

  await step("orders create/update/get", async () => {
    const createResp = await request("POST", "/api/orders", {
      company_name: "测试公司",
      orderer: "测试员",
      receive_date: "2026-04-09",
      business_type: "空运",
      customer_id: state.customerId,
      sender_id: state.senderId,
      shipping_address: "深圳",
      sender_name: "Smoke Sender 2",
      sender_phone: "13900000000",
      delivery_address: "上海",
      receiver_name: "Smoke Receiver 2",
      receiver_phone: "13600000000",
      origin: "深圳",
      destination: "上海",
      trade_term: "FOB",
      product_name: "测试产品-更新",
      remark1: "订单创建测试",
      remark2: "自动化冒烟",
    });
    assertStatus(createResp, [200], "orders create");
    state.orderId = createResp.data.id;
    state.serialNumber = createResp.data.serial_number;

    const updateResp = await request("PUT", `/api/orders/${state.orderId}`, {
      company_name: "测试公司-更新",
      orderer: "测试员2",
      receive_date: "2026-04-10",
      business_type: "海运",
      customer_id: state.customerId,
      sender_id: state.senderId,
      shipping_address: "广州",
      sender_name: "Smoke Sender 2",
      sender_phone: "13900000000",
      delivery_address: "杭州",
      receiver_name: "Smoke Receiver 2",
      receiver_phone: "13600000000",
      origin: "广州",
      destination: "杭州",
      trade_term: "CIF",
      product_name: "测试产品-更新",
      remark1: "订单更新测试",
      remark2: "自动化冒烟",
    });
    assertStatus(updateResp, [200], "orders update");

    const getResp = await request("GET", `/api/orders/${state.orderId}`);
    assertStatus(getResp, [200], "orders get");
  });

  await step("packages update/get by serial", async () => {
    const updateResp = await request("PUT", `/api/packages/serial/${state.serialNumber}`, {
      product_name: "包裹品名",
      product_code: "PK001",
      pieces: 2,
      length: 10,
      width: 20,
      height: 30,
      volume: 0.006,
      charge_weight: 3.2,
      package_type: "纸箱",
      customs_port: "上海",
      customs_title: "测试抬头",
      regulatory_conditions: "无",
      remark1: "包裹更新",
      remark2: "smoke",
    });
    assertStatus(updateResp, [200], "packages update by serial");

    const getResp = await request("GET", `/api/packages/serial/${state.serialNumber}`);
    assertStatus(getResp, [200], "packages get by serial");
  });

  await step("pickup-trackings update/get by serial", async () => {
    const updateResp = await request("PUT", `/api/pickup-trackings/serial/${state.serialNumber}`, {
      transport_mode: "陆运",
      tracking_number: `PT${ts}`,
      origin: "广州",
      destination: "杭州",
      customs_port: "杭州",
      customs_title: "报关抬头",
      pickup_date: "2026-04-11",
      arrival_time: "2026-04-11 12:00:00",
      transport_supplier: "测试供应商",
      contract_number: "HT-SMOKE-1",
      cargo_flow_info: "已提货",
      value_added_services: "保价",
      remark1: "pickup更新",
      remark2: "smoke",
    });
    assertStatus(updateResp, [200], "pickup update by serial");

    const getResp = await request("GET", `/api/pickup-trackings/serial/${state.serialNumber}`);
    assertStatus(getResp, [200], "pickup get by serial");
  });

  await step("transfers update/get by serial", async () => {
    const updateResp = await request("PUT", `/api/transfers/serial/${state.serialNumber}`, {
      transport_mode: "海运",
      tracking_number: `TR${ts}`,
      contract_number: "CT-SMOKE-1",
      pickup_date: "2026-04-11",
      arrival_port_time: "2026-04-12 10:00:00",
      clearance_time: "2026-04-13 15:00:00",
      delivery_time: "2026-04-14 18:00:00",
      complete_docs_send_time: "2026-04-12 11:00:00",
      cargo_flow_info: "在途",
      supplier: "测试物流",
      value_added_services: "贴标",
      billing_period: "2026-04",
      remark1: "transfer更新",
      remark2: "smoke",
      remark3: "ok",
    });
    assertStatus(updateResp, [200], "transfer update by serial");

    const getResp = await request("GET", `/api/transfers/serial/${state.serialNumber}`);
    assertStatus(getResp, [200], "transfer get by serial");
  });

  await step("customs-clearance update/get by serial", async () => {
    const updateResp = await request("PUT", `/api/customs-clearance/serial/${state.serialNumber}`, {
      customs_start_time: "2026-04-12 09:00:00",
      tax_payment_time: "2026-04-12 13:00:00",
      release_time: "2026-04-13 10:30:00",
      customs_declaration_number: `BG${ts}`,
      customs_supplier: "测试报关行",
      remark1: "customs更新",
      remark2: "smoke",
    });
    assertStatus(updateResp, [200], "customs update by serial");

    const getResp = await request("GET", `/api/customs-clearance/serial/${state.serialNumber}`);
    assertStatus(getResp, [200], "customs get by serial");
  });

  await step("cleanup created records", async () => {
    if (state.orderId) {
      const resp = await request("DELETE", `/api/orders/${state.orderId}`);
      assertStatus(resp, [200], "orders delete");
    }
    if (state.productId) {
      const resp = await request("DELETE", `/api/products/${state.productId}`);
      assertStatus(resp, [200], "products delete");
    }
    if (state.userId) {
      const resp = await request("DELETE", `/api/users/${state.userId}`);
      assertStatus(resp, [200], "users delete");
    }

    await request("DELETE", `/api/senders/${state.senderId}`);
    await request("DELETE", `/api/customers/${state.customerId}`);
    await request("DELETE", `/api/guests/${state.guestId}`);
  });

  const failed = result.filter((r) => !r.ok);
  console.log("\n===== API Smoke Summary =====");
  for (const r of result) {
    console.log(`${r.ok ? "PASS" : "FAIL"} - ${r.module}${r.ok ? "" : ` -> ${r.error}`}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
})();
