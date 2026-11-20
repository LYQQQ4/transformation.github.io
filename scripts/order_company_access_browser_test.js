const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", {
  paths: [process.cwd(), path.resolve("logs/browser-tools")],
}));

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const base = process.env.ORDER_ACCESS_TEST_URL || "http://127.0.0.1:3105";
  const longCompany = "Long company name ".repeat(11).trim();
  try {
    for (const [name, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let saved = ["Acme"];
      let missingUser = false;
      // Mock only API data: load all actual HTML, CSS and page scripts together.
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        let body = {};
        let status = 200;
        if (url.pathname === "/api/auth/me") {
          body = { user: { id: 1, username: "Browser Admin", role: "admin" } };
        } else if (url.pathname === "/api/users") {
          body = { users: [{ id: 2, username: "Operator", role: "user", created_at: "2026-11-20" }] };
        } else if (url.pathname === "/api/users/order-companies") {
          body = { companies: ["Acme", "Beta", longCompany] };
        } else if (url.pathname === "/api/users/2/order-companies") {
          if (missingUser) {
            status = 404;
            body = { error: "User not found" };
          } else {
            if (route.request().method() === "PUT") saved = route.request().postDataJSON().companies;
            body = { user_id: "2", companies: saved };
          }
        } else if (url.pathname === "/api/user-profiles") {
          body = { userProfiles: [
            { id: "ch001", company_name: "Sender Co", address: "S", contact_name: "Sender", phone: "123" },
            { id: "ch002", company_name: "Receiver Co", address: "R", contact_name: "Receiver", phone: "456" },
          ] };
        } else if (url.pathname === "/api/input-memory/suggestions") {
          body = { fields: { company_name: [{ value: "Acme" }] } };
        } else if (url.pathname === "/api/orders") {
          body = { orders: [], total: 0 };
        }
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      });
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.locator("#mainApp").waitFor({ state: "visible" });
      await page.locator("#userManagementLink").click();
      await page.getByRole("button", { name: "公司名称权限", exact: true }).click();
      await page.getByText("已授权 1 家公司", { exact: true }).waitFor();
      const options = page.locator("#orderCompanyPermissionsOptions");
      assert.equal(await options.locator("input").count(), 3);
      await options.locator('input[value="Beta"]').check();
      await page.locator("#orderCompanyPermissions").getByRole("button", { name: "保存", exact: true }).click();
      await page.getByText("已授权 2 家公司", { exact: true }).waitFor();
      assert.deepEqual([...saved].sort(), ["Acme", "Beta"]);
      assert.ok(await options.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        "permission page must fit the viewport");
      await page.screenshot({ path: `logs/order_company_access_${name}.png`, fullPage: true });
      missingUser = true;
      await page.getByRole("button", { name: "公司名称权限", exact: true }).click();
      await page.locator("#orderCompanyPermissionsStatus").filter({
        hasText: "加载用户 2 的公司权限失败: User not found",
      }).waitFor();
      await page.locator("#orderCompanyPermissions").getByRole("button", { name: "关闭", exact: true }).click();
      await page.evaluate(() => showOrderForm());
      const form = page.locator("#orderModal #orderFormData");
      const company = form.locator("#companyName");
      await company.waitFor({ state: "visible" });
      const bounds = await page.locator("#orderModal .modal-content").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1,
        "order form must fit the viewport");
      await page.waitForFunction(() => window.userProfilesData?.length === 2);
      for (const value of ["", "Independent Owner"]) {
        await company.fill(value);
        await form.locator("#customerId").fill("ch002");
        await form.locator("#customerId").dispatchEvent("change");
        await form.locator("#senderId").fill("ch001");
        await form.locator("#senderId").dispatchEvent("change");
        assert.equal(await company.inputValue(), value);
        assert.equal(await form.locator("#senderCompany").inputValue(), "Sender Co");
        assert.equal(await form.locator("#receiverCompany").inputValue(), "Receiver Co");
      }
      await page.screenshot({ path: `logs/order_company_form_${name}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      console.log(`PASS: ${name} permission loading/save/errors and independent company field (mock APIs)`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
