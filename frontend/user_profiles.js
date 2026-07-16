(function () {
  const PAGE_ID = "userProfilesPage";
  const LINK_ID = "userProfilesLink";
  const LEGACY_PAGE_IDS = ["senderDBPage", "customerDBPage"];
  const LEGACY_LINK_IDS = ["senderDBLink", "customerDBLink"];
  const PROFILE_FIELDS = [
    { key: "id", label: "用户ID", required: true },
    { key: "company_name", label: "公司名称" },
    { key: "address", label: "地址" },
    { key: "contact_name", label: "联系人姓名" },
    { key: "phone", label: "电话" },
    { key: "email", label: "邮箱" },
    { key: "remark", label: "备注" },
  ];

  let currentSearchTerm = "";
  let currentDetailProfileId = "";
  let currentEditingProfileId = "";
  let currentDuplicateSourceId = "";
  const ORDER_PROFILE_LIST_IDS = {
    customer: "orderCustomerIdOptions",
    sender: "orderSenderIdOptions",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getUserProfiles() {
    return Array.isArray(window.userProfilesData) ? window.userProfilesData : [];
  }

  function setUserProfiles(profiles) {
    window.userProfilesData = Array.isArray(profiles) ? profiles : [];
    syncLegacyCaches(window.userProfilesData);
  }

  function syncLegacyCaches(profiles) {
    window.sendersData = profiles.map((profile) => ({
      sender_id: profile.id,
      shipping_address: profile.address || "",
      sender_name: profile.contact_name || "",
      sender_phone: profile.phone || "",
      address: profile.address || "",
      contact_name: profile.contact_name || "",
      phone: profile.phone || "",
      company_name: profile.company_name || "",
      email: profile.email || "",
      remark: profile.remark || "",
    }));

    window.customersData = profiles.map((profile) => ({
      customer_id: profile.id,
      delivery_address: profile.address || "",
      receiver_name: profile.contact_name || "",
      receiver_phone: profile.phone || "",
      address: profile.address || "",
      contact_name: profile.contact_name || "",
      phone: profile.phone || "",
      company_name: profile.company_name || "",
      email: profile.email || "",
      remark: profile.remark || "",
    }));
  }

  function normalizeProfilePayload(payload) {
    const result = {};
    PROFILE_FIELDS.forEach((field) => {
      result[field.key] = String(payload[field.key] ?? "").trim();
    });
    return result;
  }

  function readFormPayload() {
    const payload = {};
    PROFILE_FIELDS.forEach((field) => {
      const input = document.getElementById(`userProfileForm_${field.key}`);
      payload[field.key] = input ? input.value.trim() : "";
    });
    return normalizeProfilePayload(payload);
  }

  function writeFormPayload(profile) {
    PROFILE_FIELDS.forEach((field) => {
      const input = document.getElementById(`userProfileForm_${field.key}`);
      if (input) {
        input.value = profile?.[field.key] || "";
      }
    });
  }

  function setFormMode(mode, profileId = "", duplicateSourceId = "") {
    currentEditingProfileId = mode === "edit" ? profileId : "";
    currentDuplicateSourceId = mode === "duplicate" ? duplicateSourceId : "";

    const title = document.getElementById("userProfileFormTitle");
    const idInput = document.getElementById("userProfileForm_id");
    const hint = document.getElementById("userProfileFormHint");

    if (title) {
      title.textContent =
        mode === "edit" ? "编辑用户信息" : mode === "duplicate" ? "复制用户信息" : "新增用户信息";
    }

    if (hint) {
      hint.textContent =
        mode === "edit"
          ? "编辑时保留当前用户 ID。"
          : "用户 ID 需符合 国家+编号 格式，例如 ch001、us002。";
    }

    if (idInput) {
      idInput.readOnly = mode === "edit";
    }
  }

  function buildPageMarkup() {
    return `
      <div id="${PAGE_ID}" class="page" style="display:none;">
        <div class="section">
          <h2>用户信息库</h2>
          <div class="import-section" style="margin-bottom: 24px;">
            <h4>批量导入 Excel 文件</h4>
            <input type="file" id="userProfilesExcelFile" accept=".xlsx,.xls">
            <button type="button" onclick="previewUserProfilesExcel()">预览数据</button>
            <button type="button" onclick="importUserProfilesExcelBatch()" style="margin-left: 8px;">批量导入</button>
            <button type="button" onclick="downloadUserProfilesImportTemplate()" style="margin-left: 8px;">下载 Excel 模板</button>
            <button type="button" onclick="exportUserProfiles()">导出</button>
            <div id="userProfilesImportMessage"></div>
            <div id="userProfilesImportResults" style="display: none;">
              <h5>导入结果</h5>
              <div id="userProfilesImportSummary"></div>
              <div id="userProfilesImportErrors"></div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
            <button onclick="loadUserProfiles()">加载用户信息</button>
            <button onclick="showUserProfileForm()">新增用户</button>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="text" id="userProfilesSearchInput" placeholder="搜索用户ID/公司/联系人/电话/邮箱..." style="padding: 8px 12px; border: 1px solid #D1D5DB; border-radius: 6px; font-size: 14px; width: 280px;">
              <button onclick="searchUserProfiles()">搜索</button>
            </div>
          </div>

          <div id="userProfileForm" style="display:none; margin-top: 16px; padding: 16px; background-color: #F9FAFB; border-radius: 6px; border: 1px solid #E5E7EB;">
            <h3 id="userProfileFormTitle" style="margin: 0 0 16px 0; color: #111827; font-size: 16px; font-weight: 600;">用户信息表单</h3>
            <div id="userProfileFormHint" class="info" style="margin-bottom: 12px;">用户 ID 需符合 国家+编号 格式，例如 ch001、us002。</div>
            <form id="userProfileFormData">
              <div class="form-group">
                <label>用户ID:</label>
                <input type="text" id="userProfileForm_id" required>
              </div>
              <div class="form-group">
                <label>公司名称:</label>
                <input type="text" id="userProfileForm_company_name">
              </div>
              <div class="form-group">
                <label>地址:</label>
                <textarea id="userProfileForm_address"></textarea>
              </div>
              <div class="form-group">
                <label>联系人姓名:</label>
                <input type="text" id="userProfileForm_contact_name">
              </div>
              <div class="form-group">
                <label>电话:</label>
                <input type="text" id="userProfileForm_phone">
              </div>
              <div class="form-group">
                <label>邮箱:</label>
                <input type="email" id="userProfileForm_email">
              </div>
              <div class="form-group">
                <label>备注:</label>
                <textarea id="userProfileForm_remark"></textarea>
              </div>
              <div class="button-group" style="text-align: left; margin-top: 16px;">
                <button type="button" onclick="saveUserProfile()">保存</button>
                <button type="button" onclick="hideUserProfileForm()">取消</button>
              </div>
            </form>
          </div>

          <table id="userProfilesTable">
            <thead>
              <tr>
                <th>用户ID</th>
                <th>公司名称</th>
                <th>地址</th>
                <th>联系人姓名</th>
                <th>电话</th>
                <th>邮箱</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;
  }

  function buildLegacyFallbackMarkup(title) {
    return `
      <div class="section">
        <h2>用户信息库（兼容入口）</h2>
        <p>该入口已兼容切换到统一用户信息库。</p>
        <button type="button" onclick="showPage('userProfiles')">打开用户信息库</button>
      </div>
    `;
  }

  function ensureUnifiedMenuLink() {
    const systemMenu = document.querySelector(".sidebar-content h2 + ul + h2 + ul");
    const productLink = document.getElementById("productDBLink");
    if (!systemMenu || !productLink || document.getElementById(LINK_ID)) {
      return;
    }

    const item = document.createElement("li");
    item.innerHTML = `<a href="#" id="${LINK_ID}" onclick="showPage('userProfiles')">　　用户信息库</a>`;
    systemMenu.insertBefore(item, productLink.parentElement);
  }

  function ensureUnifiedPage() {
    const mainContent = document.querySelector(".main-content");
    if (!mainContent || document.getElementById(PAGE_ID)) {
      return;
    }

    const anchor = document.getElementById("productDBPage");
    const wrapper = document.createElement("div");
    wrapper.innerHTML = buildPageMarkup();
    const page = wrapper.firstElementChild;
    if (anchor) {
      mainContent.insertBefore(page, anchor);
    } else {
      mainContent.appendChild(page);
    }
  }

  function replaceLegacyPages() {
    const senderPage = document.getElementById("senderDBPage");
    const customerPage = document.getElementById("customerDBPage");
    if (senderPage) {
      senderPage.innerHTML = buildLegacyFallbackMarkup("用户信息库（兼容入口）");
    }
    if (customerPage) {
      customerPage.innerHTML = buildLegacyFallbackMarkup("用户信息库（兼容入口）");
    }
  }

  function ensureOrderProfileAutocomplete() {
    const form = document.getElementById("orderFormData");
    if (!form) {
      return;
    }

    const customerInput = form.querySelector("#customerId");
    const senderInput = form.querySelector("#senderId");
    if (!customerInput || !senderInput) {
      return;
    }

    let customerList = document.getElementById(ORDER_PROFILE_LIST_IDS.customer);
    if (!customerList) {
      customerList = document.createElement("datalist");
      customerList.id = ORDER_PROFILE_LIST_IDS.customer;
      document.body.appendChild(customerList);
    }

    let senderList = document.getElementById(ORDER_PROFILE_LIST_IDS.sender);
    if (!senderList) {
      senderList = document.createElement("datalist");
      senderList.id = ORDER_PROFILE_LIST_IDS.sender;
      document.body.appendChild(senderList);
    }

    customerInput.setAttribute("list", ORDER_PROFILE_LIST_IDS.customer);
    senderInput.setAttribute("list", ORDER_PROFILE_LIST_IDS.sender);
    customerInput.setAttribute("autocomplete", "off");
    senderInput.setAttribute("autocomplete", "off");

    if (customerInput.dataset.profileBound !== "true") {
      customerInput.addEventListener("input", function onCustomerInput(event) {
        handleOrderProfileInput(event, "customer");
      });
      customerInput.addEventListener("focus", function onCustomerFocus(event) {
        handleOrderProfileInput(event, "customer");
      });
      customerInput.dataset.profileBound = "true";
    }

    if (senderInput.dataset.profileBound !== "true") {
      senderInput.addEventListener("input", function onSenderInput(event) {
        handleOrderProfileInput(event, "sender");
      });
      senderInput.addEventListener("focus", function onSenderFocus(event) {
        handleOrderProfileInput(event, "sender");
      });
      senderInput.dataset.profileBound = "true";
    }

    populateOrderProfileOptions(customerInput.value, "customer");
    populateOrderProfileOptions(senderInput.value, "sender");
  }

  function populateOrderProfileOptions(keyword, type) {
    const listId = type === "customer" ? ORDER_PROFILE_LIST_IDS.customer : ORDER_PROFILE_LIST_IDS.sender;
    const datalist = document.getElementById(listId);
    if (!datalist) {
      return;
    }

    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    const profiles = getUserProfiles();
    const matchedProfiles = profiles
      .filter((profile) => {
        if (!normalizedKeyword) {
          return true;
        }
        return [profile.id, profile.company_name, profile.contact_name, profile.phone]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
      })
      .slice(0, 20);

    datalist.innerHTML = matchedProfiles
      .map((profile) => {
        const summary = [profile.company_name, profile.contact_name, profile.phone].filter(Boolean).join(" / ");
        return `<option value="${escapeHtml(profile.id)}" label="${escapeHtml(summary)}"></option>`;
      })
      .join("");
  }

  function showOrderProfileHint(field, message, type = "info") {
    const hint = document.getElementById(field === "customer" ? "customerIdHint" : "senderIdHint");
    if (!hint) {
      return;
    }
    hint.textContent = message;
    hint.className = type;
  }

  function clearOrderProfileHint(field) {
    const hint = document.getElementById(field === "customer" ? "customerIdHint" : "senderIdHint");
    if (!hint) {
      return;
    }
    hint.textContent = "";
    hint.className = "info";
  }

  function applyCustomerProfileToOrder(form, profile) {
    const company = form.querySelector("#companyName");
    const address = form.querySelector("#deliveryAddress");
    const name = form.querySelector("#receiverName");
    const phone = form.querySelector("#receiverPhone");

    if (company) {
      company.value = profile.company_name || "";
    }
    if (address) {
      address.value = profile.address || "";
    }
    if (name) {
      name.value = profile.contact_name || "";
    }
    if (phone) {
      phone.value = profile.phone || "";
    }
  }

  function applySenderProfileToOrder(form, profile) {
    const address = form.querySelector("#shippingAddress");
    const name = form.querySelector("#senderName");
    const phone = form.querySelector("#senderPhone");

    if (address) {
      address.value = profile.address || "";
    }
    if (name) {
      name.value = profile.contact_name || "";
    }
    if (phone) {
      phone.value = profile.phone || "";
    }
  }

  function handleOrderProfileInput(event, field) {
    const value = event.target.value.trim();
    populateOrderProfileOptions(value, field);

    if (!value) {
      clearOrderProfileHint(field);
      return;
    }

    const profile = findProfileById(value);
    if (!profile) {
      showOrderProfileHint(field, "未匹配到现有用户ID，可继续输入，提交时将由后端校验。", "info");
      return;
    }

    clearOrderProfileHint(field);
    const form = event.target.closest("#orderFormData");
    if (!form) {
      return;
    }

    if (field === "customer") {
      applyCustomerProfileToOrder(form, profile);
    } else {
      applySenderProfileToOrder(form, profile);
    }
  }

  function showImportMessage(message, type = "info") {
    const el = document.getElementById("userProfilesImportMessage");
    if (!el) {
      return;
    }
    el.innerHTML = message;
    el.className = type;
  }

  function renderUserProfilesTable(profiles) {
    const tbody = document.querySelector("#userProfilesTable tbody");
    if (!tbody) {
      return;
    }

    tbody.innerHTML = "";
    profiles.forEach((profile) => {
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${escapeHtml(profile.id)}</td>
        <td>${escapeHtml(profile.company_name || "")}</td>
        <td>${escapeHtml(profile.address || "")}</td>
        <td>${escapeHtml(profile.contact_name || "")}</td>
        <td>${escapeHtml(profile.phone || "")}</td>
        <td>${escapeHtml(profile.email || "")}</td>
        <td>${escapeHtml(profile.remark || "")}</td>
        <td>
          <button type="button" onclick="viewUserProfileDetail('${escapeHtml(profile.id)}')">详情</button>
          <button type="button" onclick="editUserProfile('${escapeHtml(profile.id)}')">编辑</button>
          <button type="button" onclick="duplicateUserProfile('${escapeHtml(profile.id)}')">复制</button>
          <button type="button" onclick="deleteUserProfile('${escapeHtml(profile.id)}')">删除</button>
        </td>
      `;
    });
  }

  function filterUserProfiles(profiles, term) {
    if (!term) {
      return profiles;
    }

    const keyword = term.toLowerCase();
    return profiles.filter((profile) =>
      [
        profile.id,
        profile.company_name,
        profile.address,
        profile.contact_name,
        profile.phone,
        profile.email,
        profile.remark,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }

  function refreshView() {
    const filtered = filterUserProfiles(getUserProfiles(), currentSearchTerm);
    renderUserProfilesTable(filtered);
  }

  async function fetchUserProfiles() {
    const response = await fetch(`${window.API_BASE}/user-profiles`);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "加载用户信息失败");
    }
    return result.userProfiles || [];
  }

  async function loadUserProfiles() {
    try {
      const profiles = await fetchUserProfiles();
      setUserProfiles(profiles);
      refreshView();
    } catch (error) {
      window.showMessage(error.message, "error");
    }
  }

  function searchUserProfiles() {
    currentSearchTerm = (document.getElementById("userProfilesSearchInput")?.value || "").trim();
    refreshView();
  }

  function showUserProfileForm(profile = null, mode = "create") {
    const form = document.getElementById("userProfileForm");
    const formData = document.getElementById("userProfileFormData");
    if (!form || !formData) {
      return;
    }

    formData.reset();
    writeFormPayload(profile || {});

    if (mode === "duplicate" && profile) {
      const duplicatePayload = { ...profile, id: "" };
      writeFormPayload(duplicatePayload);
      setFormMode("duplicate", "", profile.id);
    } else if (mode === "edit" && profile) {
      setFormMode("edit", profile.id, "");
    } else {
      setFormMode("create", "", "");
    }

    form.style.display = "block";
  }

  function hideUserProfileForm() {
    const form = document.getElementById("userProfileForm");
    const formData = document.getElementById("userProfileFormData");
    if (form) {
      form.style.display = "none";
    }
    if (formData) {
      formData.reset();
    }
    setFormMode("create", "", "");
  }

  async function saveUserProfile() {
    const payload = readFormPayload();
    if (!payload.id) {
      window.showMessage("用户ID不能为空", "error");
      return;
    }

    try {
      let response;
      if (currentEditingProfileId) {
        response = await fetch(`${window.API_BASE}/user-profiles/${encodeURIComponent(currentEditingProfileId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch(`${window.API_BASE}/user-profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "保存用户信息失败");
      }

      hideUserProfileForm();
      await loadUserProfiles();
      window.showMessage(currentEditingProfileId ? "用户信息更新成功" : "用户信息保存成功");
    } catch (error) {
      window.showMessage(error.message, "error");
    }
  }

  function findProfileById(id) {
    return getUserProfiles().find((profile) => profile.id === id) || null;
  }

  function viewUserProfileDetail(id) {
    const profile = findProfileById(id);
    if (!profile) {
      window.showMessage("用户信息不存在", "error");
      return;
    }

    currentDetailProfileId = id;
    const lines = PROFILE_FIELDS.map(
      (field) =>
        `<div><strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(profile[field.key] || "")}</div>`
    );

    const html = `
      <div class="detail-grid">${lines.join("")}</div>
      <div class="button-group" style="text-align: left; margin-top: 16px;">
        <button type="button" onclick="editUserProfile('${escapeHtml(id)}')">编辑</button>
        <button type="button" onclick="duplicateUserProfile('${escapeHtml(id)}')">复制</button>
      </div>
    `;

    if (typeof window.showDetailModal === "function") {
      window.showDetailModal("用户信息详情", html);
      return;
    }

    alert(
      PROFILE_FIELDS.map((field) => `${field.label}: ${profile[field.key] || ""}`).join("\n")
    );
  }

  function editUserProfile(id) {
    const profile = findProfileById(id);
    if (!profile) {
      window.showMessage("用户信息不存在", "error");
      return;
    }
    showUserProfileForm(profile, "edit");
  }

  function duplicateUserProfile(id) {
    const profile = findProfileById(id);
    if (!profile) {
      window.showMessage("用户信息不存在", "error");
      return;
    }
    showUserProfileForm(profile, "duplicate");
  }

  async function deleteUserProfile(id) {
    if (!window.confirm("确定删除这条用户信息吗？")) {
      return;
    }

    try {
      const response = await fetch(`${window.API_BASE}/user-profiles/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "删除用户信息失败");
      }

      await loadUserProfiles();
      window.showMessage("用户信息删除成功");
    } catch (error) {
      window.showMessage(error.message, "error");
    }
  }

  async function previewUserProfilesExcel() {
    const fileInput = document.getElementById("userProfilesExcelFile");
    if (!fileInput?.files?.length) {
      showImportMessage("请选择要导入的 Excel 文件", "error");
      return;
    }

    try {
      showImportMessage("正在解析 Excel 文件...", "info");
      const formData = new FormData();
      formData.append("excelFile", fileInput.files[0]);
      const response = await fetch(`${window.API_BASE}/user-profiles/parse-excel`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "预览失败");
      }

      showUserProfileForm(result.data, "create");
      showImportMessage("数据预览成功，请检查后保存或批量导入。", "success");
    } catch (error) {
      showImportMessage(error.message, "error");
    }
  }

  async function importUserProfilesExcelBatch() {
    const fileInput = document.getElementById("userProfilesExcelFile");
    if (!fileInput?.files?.length) {
      showImportMessage("请选择要导入的 Excel 文件", "error");
      return;
    }

    try {
      showImportMessage("正在批量导入用户信息...", "info");
      const formData = new FormData();
      formData.append("excelFile", fileInput.files[0]);
      const response = await fetch(`${window.API_BASE}/user-profiles/import-excel`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "批量导入失败");
      }

      if (typeof window.displayLibraryImportResults === "function") {
        window.displayLibraryImportResults(
          result,
          "userProfilesImportResults",
          "userProfilesImportSummary",
          "userProfilesImportErrors"
        );
      }

      showImportMessage(result.message, result.success ? "success" : "error");
      await loadUserProfiles();
    } catch (error) {
      showImportMessage(error.message, "error");
    }
  }

  async function downloadUserProfilesImportTemplate() {
    try {
      showImportMessage("正在下载 Excel 模板...", "info");
      const response = await fetch(`${window.API_BASE}/user-profiles/import-template`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "下载模板失败");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "user_profiles_import_template.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showImportMessage("Excel 模板下载成功", "success");
    } catch (error) {
      showImportMessage(error.message, "error");
    }
  }

  function exportUserProfiles() {
    const profiles = filterUserProfiles(getUserProfiles(), currentSearchTerm);
    if (!profiles.length) {
      window.showMessage("没有可导出的用户信息", "error");
      return;
    }

    const rows = [
      ["用户ID", "公司名称", "地址", "联系人姓名", "电话", "邮箱", "备注"],
      ...profiles.map((profile) => [
        profile.id || "",
        profile.company_name || "",
        profile.address || "",
        profile.contact_name || "",
        profile.phone || "",
        profile.email || "",
        profile.remark || "",
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "user_profiles_export.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function patchLegacyApiFunctions() {
    window.loadSenders = async function loadSendersCompat() {
      await loadUserProfiles();
      return window.sendersData;
    };

    window.loadCustomers = async function loadCustomersCompat() {
      await loadUserProfiles();
      return window.customersData;
    };

    window.searchSenders = function searchSendersCompat() {
      const input = document.getElementById("senderSearchInput");
      currentSearchTerm = (input?.value || "").trim();
      if (document.getElementById("userProfilesSearchInput")) {
        document.getElementById("userProfilesSearchInput").value = currentSearchTerm;
      }
      window.showPage("userProfiles");
      refreshView();
    };

    window.searchCustomers = function searchCustomersCompat() {
      const input = document.getElementById("customerSearchInput");
      currentSearchTerm = (input?.value || "").trim();
      if (document.getElementById("userProfilesSearchInput")) {
        document.getElementById("userProfilesSearchInput").value = currentSearchTerm;
      }
      window.showPage("userProfiles");
      refreshView();
    };

    window.showSenderForm = function showSenderFormCompat() {
      window.showPage("userProfiles");
      showUserProfileForm();
    };

    window.showCustomerForm = function showCustomerFormCompat() {
      window.showPage("userProfiles");
      showUserProfileForm();
    };

    window.hideSenderForm = hideUserProfileForm;
    window.hideCustomerForm = hideUserProfileForm;

    window.saveSender = saveUserProfile;
    window.saveCustomer = saveUserProfile;

    window.editSender = editUserProfile;
    window.editCustomer = editUserProfile;

    window.deleteSender = deleteUserProfile;
    window.deleteCustomer = deleteUserProfile;

    window.previewSenderExcel = previewUserProfilesExcel;
    window.previewCustomerExcel = previewUserProfilesExcel;
    window.importSenderExcelBatch = importUserProfilesExcelBatch;
    window.importCustomerExcelBatch = importUserProfilesExcelBatch;
  }

  function patchOrderHandlers() {
    window.handleCustomerIdChange = function handleCustomerIdChangeCompat(event) {
      const customerId = event.target.value.trim();
      if (!customerId) {
        clearOrderProfileHint("customer");
        return;
      }

      const customer = findProfileById(customerId);
      if (!customer) {
        showOrderProfileHint("customer", "未匹配到现有用户ID，可继续输入，提交时将由后端校验。", "info");
        return;
      }

      const form = event.target.closest("#orderFormData");
      if (!form) {
        return;
      }

      clearOrderProfileHint("customer");
      applyCustomerProfileToOrder(form, customer);
    };

    window.handleSenderIdChange = function handleSenderIdChangeCompat(event) {
      const senderId = event.target.value.trim();
      if (!senderId) {
        clearOrderProfileHint("sender");
        return;
      }

      const sender = findProfileById(senderId);
      if (!sender) {
        showOrderProfileHint("sender", "未匹配到现有用户ID，可继续输入，提交时将由后端校验。", "info");
        return;
      }

      const form = event.target.closest("#orderFormData");
      if (!form) {
        return;
      }

      clearOrderProfileHint("sender");
      applySenderProfileToOrder(form, sender);
    };
  }

  function patchShowPage() {
    const originalShowPage = window.showPage;
    if (typeof originalShowPage !== "function") {
      return;
    }

    window.showPage = function showPageCompat(pageName) {
      if (pageName === "senderDB" || pageName === "customerDB") {
        pageName = "userProfiles";
      }

      originalShowPage(pageName === "userProfiles" ? "__userProfilesShim__" : pageName);

      if (pageName === "userProfiles") {
        const importBar = document.getElementById("ordersImportBar");
        const importResults = document.getElementById("importResults");
        if (importBar) {
          importBar.style.display = "none";
        }
        if (importResults) {
          importResults.style.display = "none";
        }

        const page = document.getElementById(PAGE_ID);
        if (page) {
          page.style.display = "block";
        }

        const link = document.getElementById(LINK_ID);
        if (link) {
          document.querySelectorAll(".sidebar a").forEach((node) => node.classList.remove("active"));
          link.classList.add("active");
        }

        loadUserProfiles();
      }
    };
  }

  function patchOnload() {
    const originalOnload = window.onload;
    window.onload = function onloadCompat(event) {
      if (typeof originalOnload === "function") {
        originalOnload.call(window, event);
      }

      ensureOrderProfileAutocomplete();

      const searchInput = document.getElementById("userProfilesSearchInput");
      if (searchInput && searchInput.dataset.bound !== "true") {
        searchInput.addEventListener("keypress", function onUserProfilesSearchKeypress(keyEvent) {
          if (keyEvent.key === "Enter") {
            searchUserProfiles();
          }
        });
        searchInput.dataset.bound = "true";
      }

      loadUserProfiles().catch(() => {});
    };
  }

  function patchSenderCustomerLinks() {
    LEGACY_LINK_IDS.forEach((id) => {
      const link = document.getElementById(id);
      if (!link) {
        return;
      }
      link.onclick = function onLegacyLinkClick() {
        window.showPage("userProfiles");
        return false;
      };
    });
  }

  function init() {
    ensureUnifiedMenuLink();
    ensureUnifiedPage();
    replaceLegacyPages();
    patchLegacyApiFunctions();
    patchOrderHandlers();
    patchShowPage();
    patchOnload();
    patchSenderCustomerLinks();
    syncLegacyCaches(getUserProfiles());
    ensureOrderProfileAutocomplete();
  }

  window.loadUserProfiles = loadUserProfiles;
  window.searchUserProfiles = searchUserProfiles;
  window.showUserProfileForm = showUserProfileForm;
  window.hideUserProfileForm = hideUserProfileForm;
  window.saveUserProfile = saveUserProfile;
  window.viewUserProfileDetail = viewUserProfileDetail;
  window.editUserProfile = editUserProfile;
  window.duplicateUserProfile = duplicateUserProfile;
  window.deleteUserProfile = deleteUserProfile;
  window.previewUserProfilesExcel = previewUserProfilesExcel;
  window.importUserProfilesExcelBatch = importUserProfilesExcelBatch;
  window.downloadUserProfilesImportTemplate = downloadUserProfilesImportTemplate;
  window.exportUserProfiles = exportUserProfiles;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
