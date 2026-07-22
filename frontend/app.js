// API base URL
const API_BASE = (() => {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        return `${window.location.origin}/api`;
    }
    return "http://127.0.0.1:3000/api";
})();
window.API_BASE = API_BASE;

// User authentication state
let currentUser = null;
let currentOrderDetailSerial = null;

let currentOrderPackageData = null;
let currentOrderPickupTrackingData = null;
let currentOrderDeliveryTrackingData = null;
let currentOrderCustomsClearanceData = null;

const SHARED_TRACKING_FIELD_DEFINITIONS = {
    tracking_number: { label: "运单号" },
    transport_supplier: {
        label: "运输供应商",
        getValue: (record) => record?.transport_supplier ?? record?.supplier ?? ""
    },
    contract_number: { label: "合同协议号" },
    cargo_flow_info: { label: "货物流转信息" },
    value_added_services: { label: "增值服务备注" },
    customs_declaration_number: { label: "报关单号" },
    customs_supplier: { label: "报关供应商" },
    remark1: { label: "备注1" },
    remark2: { label: "备注2" }
};

const PICKUP_TRACKING_SHARED_FORM_FIELDS = {
    tracking_number: "#pickupTrackingNumber",
    transport_supplier: "#pickupTrackingTransportSupplier",
    contract_number: "#pickupTrackingContractNumber",
    cargo_flow_info: "#pickupTrackingCargoFlowInfo",
    value_added_services: "#pickupTrackingValueAddedServices",
    remark1: "#pickupTrackingRemark1",
    remark2: "#pickupTrackingRemark2"
};

const TRANSFER_TRACKING_SHARED_FORM_FIELDS = {
    tracking_number: "#transferTrackingNumber",
    transport_supplier: "#transferSupplier",
    cargo_flow_info: "#transferCargoFlowInfo",
    value_added_services: "#transferValueAddedServices",
    remark1: "#transferRemark1",
    remark2: "#transferRemark2"
};

const CUSTOMS_TRACKING_SHARED_FORM_FIELDS = {
    customs_declaration_number: "#customsDeclarationNumber",
    customs_supplier: "#customsSupplier",
    remark1: "#customsRemark1",
    remark2: "#customsRemark2"
};

function formatDateOnly(value) {
    if (!value) {
        return "";
    }

    const parts = extractLocalDateParts(value);
    if (!parts) {
        return String(value);
    }

    return `${parts.year}/${parts.month}/${parts.day}`;
}

function extractLocalDateParts(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (value instanceof Date) {
        if (isNaN(value.getTime())) {
            return null;
        }
        return {
            year: String(value.getFullYear()),
            month: String(value.getMonth() + 1).padStart(2, "0"),
            day: String(value.getDate()).padStart(2, "0")
        };
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            return null;
        }
        return {
            year: String(date.getFullYear()),
            month: String(date.getMonth() + 1).padStart(2, "0"),
            day: String(date.getDate()).padStart(2, "0")
        };
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        const normalized = trimmed.replace(/\//g, "-");
        const plainDateMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (plainDateMatch) {
            return {
                year: plainDateMatch[1],
                month: String(plainDateMatch[2]).padStart(2, "0"),
                day: String(plainDateMatch[3]).padStart(2, "0")
            };
        }

        const localDateTimeMatch = normalized.match(
            /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:\.\d+)?$/
        );
        if (localDateTimeMatch) {
            return {
                year: localDateTimeMatch[1],
                month: String(localDateTimeMatch[2]).padStart(2, "0"),
                day: String(localDateTimeMatch[3]).padStart(2, "0")
            };
        }

        const date = new Date(trimmed);
        if (isNaN(date.getTime())) {
            return null;
        }

        return {
            year: String(date.getFullYear()),
            month: String(date.getMonth() + 1).padStart(2, "0"),
            day: String(date.getDate()).padStart(2, "0")
        };
    }

    return null;
}
let currentUserProfileSearchTerm = "";
let userProfilesData = [];
let currentSenderSearchTerm = "";
let currentCustomerSearchTerm = "";
let sendersData = [];
let customersData = [];
let packageBoxTypes = [];
let packageBoxTypesLoaded = false;
const LEGACY_DEFAULT_PACKAGE_BOX_TYPE_ID = "BOX-DEFAULT";
const PACKAGE_BOX_TYPE_SNAPSHOT_FIELDS = ["package_type", "length", "width", "height", "volume"];

// Utility functions
function showMessage(message, type = "success") {
    const messageDiv = document.getElementById("message");
    messageDiv.textContent = message;
    messageDiv.className = type;
    setTimeout(() => messageDiv.textContent = "", 5000);
}

function showLoginMessage(message, type = "error") {
    const messageDiv = document.getElementById("loginMessage");
    messageDiv.textContent = message;
    messageDiv.className = type;
    setTimeout(() => messageDiv.textContent = "", 5000);
}

// Authentication functions
function checkAuthState() {
    const savedUser = localStorage.getItem("currentUser");
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showMainApp();
    } else {
        showAuthSection();
    }
}

function showAuthSection() {
    document.getElementById("authSection").style.display = "block";
    document.getElementById("mainApp").style.display = "none";
}

function showMainApp() {
    console.log("显示主应用界面，用户:", currentUser); // 调试信息
    document.getElementById("authSection").style.display = "none";
    document.getElementById("mainApp").style.display = "block";
    const currentUserEl = document.getElementById("currentUser");
    if (currentUserEl) {
        currentUserEl.textContent = currentUser ? currentUser.username : "未知用户";
    }
    // 默认显示查看货物订单页面
    showPage("viewOrders");
}

function showLoginForm() {
    document.getElementById("loginForm").style.display = "block";
    document.getElementById("registerForm").style.display = "none";
    document.getElementById("loginMessage").textContent = ""; // Clear login message
}

function showRegisterForm() {
    document.getElementById("loginForm").style.display = "none";
    document.getElementById("registerForm").style.display = "block";
    document.getElementById("loginMessage").textContent = ""; // Clear login message
}

async function login() {
    const username = document.getElementById("loginUsername").value;
    const password = document.getElementById("loginPassword").value;

    if (!username || !password) {
        showMessage("请输入用户名和密码", "error");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/users/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            currentUser = data.user;
            localStorage.setItem("currentUser", JSON.stringify(currentUser));
            showMessage("登录成功！正在跳转...");
            showMainApp();
            // 异步加载数据
            loadOrders().catch(err => console.error("加载订单失败:", err));
            loadUsers().catch(err => console.error("加载用户失败:", err));
        } else {
            showLoginMessage(data.error || "登录失败", "error");
        }
    } catch (error) {
        showMessage("网络错误，请检查服务器是否运行", "error");
    }
}

async function register() {
    const username = document.getElementById("registerUsername").value;
    const password = document.getElementById("registerPassword").value;
    const confirmPassword = document.getElementById("registerConfirmPassword").value;

    if (!username || !password) {
        showMessage("请输入用户名和密码", "error");
        return;
    }

    if (password !== confirmPassword) {
        showMessage("两次输入的密码不一致", "error");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, role: "user" })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage("注册成功，请登录");
            showLoginForm();
            // 清空注册表单
            document.getElementById("registerUsername").value = "";
            document.getElementById("registerPassword").value = "";
            document.getElementById("registerConfirmPassword").value = "";
        } else {
            showMessage(data.error || "注册失败", "error");
        }
    } catch (error) {
        showMessage("注册失败: " + error.message, "error");
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem("currentUser");
    showMessage("已退出登录");
    showAuthSection();
}

function clearForms() {
    const orderForm = getVisibleOrderForm();
    if (orderForm) {
        orderForm.reset();
        resetReceiveDateInputs(orderForm);
    }
    const userForm = document.getElementById("userFormData");
    if (userForm) {
        userForm.reset();
    }
}

function clearOrderForm() {
    const orderForm = getVisibleOrderForm();
    if (orderForm) {
        orderForm.reset();
        resetReceiveDateInputs(orderForm);
    }
    // 清空导入消息和文件选择
    document.getElementById("importMessage").innerHTML = "";
    document.getElementById("excelFile").value = "";
    // 隐藏导入结果
    document.getElementById("importResults").style.display = "none";
}

function getVisibleOrderForm() {
    const forms = document.querySelectorAll("#orderFormData");
    for (const form of forms) {
        if (form.offsetParent !== null) {
            return form;
        }
    }
    return forms[0] || null;
}

function getOrderFormElement(id, form = getVisibleOrderForm()) {
    if (form) {
        const element = form.querySelector(`#${id}`);
        if (element) {
            return element;
        }
    }
    return document.getElementById(id);
}

function parseReceiveDateParts(value) {
    const parts = extractLocalDateParts(value);
    return parts || { year: "", month: "", day: "" };
}

function updateReceiveDateHidden(form) {
    const yearInput = form.querySelector("#receiveDateYear");
    const monthInput = form.querySelector("#receiveDateMonth");
    const dayInput = form.querySelector("#receiveDateDay");
    const hiddenInput = form.querySelector("#receiveDate");

    if (!yearInput || !monthInput || !dayInput || !hiddenInput) {
        return;
    }

    const year = yearInput.value;
    const month = monthInput.value;
    const day = dayInput.value;

    if (year.length === 4 && month.length === 2 && day.length === 2) {
        hiddenInput.value = `${year}-${month}-${day}`;
    } else {
        hiddenInput.value = "";
    }

    syncSplitDatePickerValue("receiveDate", form);
}

function setReceiveDateValue(value, form = getVisibleOrderForm()) {
    if (!form) {
        return;
    }

    const yearInput = form.querySelector("#receiveDateYear");
    const monthInput = form.querySelector("#receiveDateMonth");
    const dayInput = form.querySelector("#receiveDateDay");
    const hiddenInput = form.querySelector("#receiveDate");

    if (!yearInput || !monthInput || !dayInput || !hiddenInput) {
        return;
    }

    const parts = parseReceiveDateParts(value);
    yearInput.value = parts.year;
    monthInput.value = parts.month;
    dayInput.value = parts.day;
    updateReceiveDateHidden(form);
}

function getReceiveDateValue(form = getVisibleOrderForm()) {
    if (!form) {
        const fallback = document.getElementById("receiveDate");
        return fallback ? fallback.value : "";
    }

    updateReceiveDateHidden(form);
    const hiddenInput = form.querySelector("#receiveDate");
    return hiddenInput ? hiddenInput.value : "";
}

function resetReceiveDateInputs(form) {
    const yearInput = form.querySelector("#receiveDateYear");
    const monthInput = form.querySelector("#receiveDateMonth");
    const dayInput = form.querySelector("#receiveDateDay");
    const hiddenInput = form.querySelector("#receiveDate");

    if (yearInput) yearInput.value = "";
    if (monthInput) monthInput.value = "";
    if (dayInput) dayInput.value = "";
    if (hiddenInput) hiddenInput.value = "";
    syncSplitDatePickerValue("receiveDate", form);
}

function setupReceiveDateInputs(form) {
    const yearInput = form.querySelector("#receiveDateYear");
    const monthInput = form.querySelector("#receiveDateMonth");
    const dayInput = form.querySelector("#receiveDateDay");

    if (!yearInput || !monthInput || !dayInput) {
        return;
    }

    const sanitize = (value, maxLength) => value.replace(/\D/g, "").slice(0, maxLength);

    yearInput.addEventListener("input", () => {
        yearInput.value = sanitize(yearInput.value, 4);
        if (yearInput.value.length === 4) {
            monthInput.focus();
        }
        updateReceiveDateHidden(form);
    });

    monthInput.addEventListener("input", () => {
        monthInput.value = sanitize(monthInput.value, 2);
        if (monthInput.value.length === 2) {
            dayInput.focus();
        }
        updateReceiveDateHidden(form);
    });

    dayInput.addEventListener("input", () => {
        dayInput.value = sanitize(dayInput.value, 2);
        updateReceiveDateHidden(form);
    });

    setupSplitDatePicker("receiveDate", form, updateReceiveDateHidden);
}

function initReceiveDateInputs() {
    const forms = document.querySelectorAll("#orderFormData");
    forms.forEach(form => setupReceiveDateInputs(form));
}

function parseDateTimeParts(value) {
    if (!value) {
        return { year: "", month: "", day: "", time: "" };
    }

    let dateStr = value;
    let timeStr = "";

    if (typeof dateStr === "string") {
        if (dateStr.includes("T")) {
            [dateStr, timeStr] = dateStr.split("T");
        } else if (dateStr.includes(" ")) {
            [dateStr, timeStr] = dateStr.split(" ");
        }
        if (timeStr) {
            timeStr = timeStr.slice(0, 5);
        }
    }

    const parts = parseReceiveDateParts(dateStr);
    return { ...parts, time: timeStr };
}

function updateTransferDateHidden(prefix, form) {
    const yearInput = form.querySelector(`#${prefix}Year`);
    const monthInput = form.querySelector(`#${prefix}Month`);
    const dayInput = form.querySelector(`#${prefix}Day`);
    const hiddenInput = form.querySelector(`#${prefix}`);

    if (!yearInput || !monthInput || !dayInput || !hiddenInput) {
        return;
    }

    const year = yearInput.value;
    const month = monthInput.value;
    const day = dayInput.value;

    if (year.length === 4 && month.length === 2 && day.length === 2) {
        hiddenInput.value = `${year}-${month}-${day}`;
    } else {
        hiddenInput.value = "";
    }

    syncSplitDatePickerValue(prefix, form);
}

function updateTransferDateTimeHidden(prefix, form) {
    const yearInput = form.querySelector(`#${prefix}Year`);
    const monthInput = form.querySelector(`#${prefix}Month`);
    const dayInput = form.querySelector(`#${prefix}Day`);
    const timeInput = form.querySelector(`#${prefix}Time`);
    const hiddenInput = form.querySelector(`#${prefix}`);

    if (!yearInput || !monthInput || !dayInput || !timeInput || !hiddenInput) {
        return;
    }

    const year = yearInput.value;
    const month = monthInput.value;
    const day = dayInput.value;
    const time = timeInput.value;

    if (year.length === 4 && month.length === 2 && day.length === 2 && time.length >= 4) {
        hiddenInput.value = `${year}-${month}-${day}T${time}`;
    } else {
        hiddenInput.value = "";
    }

    syncSplitDatePickerValue(prefix, form);
}

function setTransferDateValue(prefix, value, form) {
    if (!form) {
        return;
    }

    const yearInput = form.querySelector(`#${prefix}Year`);
    const monthInput = form.querySelector(`#${prefix}Month`);
    const dayInput = form.querySelector(`#${prefix}Day`);

    if (!yearInput || !monthInput || !dayInput) {
        return;
    }

    const parts = parseReceiveDateParts(value);
    yearInput.value = parts.year;
    monthInput.value = parts.month;
    dayInput.value = parts.day;
    updateTransferDateHidden(prefix, form);
}

function setTransferDateTimeValue(prefix, value, form) {
    if (!form) {
        return;
    }

    const yearInput = form.querySelector(`#${prefix}Year`);
    const monthInput = form.querySelector(`#${prefix}Month`);
    const dayInput = form.querySelector(`#${prefix}Day`);
    const timeInput = form.querySelector(`#${prefix}Time`);

    if (!yearInput || !monthInput || !dayInput || !timeInput) {
        return;
    }

    const parts = parseDateTimeParts(value);
    yearInput.value = parts.year;
    monthInput.value = parts.month;
    dayInput.value = parts.day;
    timeInput.value = parts.time;
    updateTransferDateTimeHidden(prefix, form);
}

function setupTransferDateInput(prefix, form, updateFn) {
    const yearInput = form.querySelector(`#${prefix}Year`);
    const monthInput = form.querySelector(`#${prefix}Month`);
    const dayInput = form.querySelector(`#${prefix}Day`);

    if (!yearInput || !monthInput || !dayInput) {
        return;
    }

    const sanitize = (value, maxLength) => value.replace(/\D/g, "").slice(0, maxLength);

    yearInput.addEventListener("input", () => {
        yearInput.value = sanitize(yearInput.value, 4);
        if (yearInput.value.length === 4) {
            monthInput.focus();
        }
        updateFn(prefix, form);
    });

    monthInput.addEventListener("input", () => {
        monthInput.value = sanitize(monthInput.value, 2);
        if (monthInput.value.length === 2) {
            dayInput.focus();
        }
        updateFn(prefix, form);
    });

    dayInput.addEventListener("input", () => {
        dayInput.value = sanitize(dayInput.value, 2);
        updateFn(prefix, form);
    });

    setupSplitDatePicker(prefix, form, updateFn);
}

function runSplitDateUpdate(updateFn, prefix, form) {
    if (typeof updateFn !== "function") {
        return;
    }

    if (updateFn.length >= 2) {
        updateFn(prefix, form);
    } else {
        updateFn(form);
    }
}

function syncSplitDatePickerValue(prefix, form) {
    if (!form) {
        return;
    }

    const pickerInput = form.querySelector(`#${prefix}Picker`);
    const yearInput = form.querySelector(`#${prefix}Year`);
    const monthInput = form.querySelector(`#${prefix}Month`);
    const dayInput = form.querySelector(`#${prefix}Day`);

    if (!pickerInput || !yearInput || !monthInput || !dayInput) {
        return;
    }

    if (yearInput.value.length === 4 && monthInput.value.length === 2 && dayInput.value.length === 2) {
        pickerInput.value = `${yearInput.value}-${monthInput.value}-${dayInput.value}`;
    } else {
        // Keep picker empty when split fields are incomplete so selecting "today"
        // still changes value and triggers the picker change event.
        pickerInput.value = "";
    }
}

function setupSplitDatePicker(prefix, form, updateFn) {
    if (!form) {
        return;
    }

    const pickerInput = form.querySelector(`#${prefix}Picker`);
    const yearInput = form.querySelector(`#${prefix}Year`);
    const monthInput = form.querySelector(`#${prefix}Month`);
    const dayInput = form.querySelector(`#${prefix}Day`);

    if (!pickerInput || !yearInput || !monthInput || !dayInput || pickerInput.dataset.bound === "true") {
        return;
    }

    pickerInput.addEventListener("change", () => {
        const parts = parseReceiveDateParts(pickerInput.value);
        yearInput.value = parts.year;
        monthInput.value = parts.month;
        dayInput.value = parts.day;
        runSplitDateUpdate(updateFn, prefix, form);
        syncSplitDatePickerValue(prefix, form);
    });

    pickerInput.dataset.bound = "true";
    syncSplitDatePickerValue(prefix, form);
}

function setupTransferDateTimeInput(prefix, form) {
    setupTransferDateInput(prefix, form, updateTransferDateTimeHidden);
    const timeInput = form.querySelector(`#${prefix}Time`);
    if (timeInput) {
        timeInput.addEventListener("input", () => updateTransferDateTimeHidden(prefix, form));
    }
}

function initTransferDateInputs(form) {
    if (!form) {
        return;
    }
    setupTransferDateInput("transferPickupDate", form, updateTransferDateHidden);
    setupTransferDateInput("transferArrivalPortTime", form, updateTransferDateHidden);
    setupTransferDateInput("transferCompleteDocsSendTime", form, updateTransferDateHidden);
}

// Global variables for filtering and searching
let currentFilters = {};
let currentSearchTerm = "";
let currentPackageSearchTerm = "";
let currentPickupTrackingSearchTerm = "";
let currentTransferSearchTerm = "";
let currentGuestSearchTerm = "";

function buildOrderFilledStatusFilterHtml(label, selectId) {
    return `
        <div class="form-group">
            <label>${label}:</label>
            <select id="${selectId}">
                <option value="all">全部</option>
                <option value="filled">已填</option>
                <option value="unfilled">未填</option>
            </select>
        </div>
    `;
}

function ensureOrderIndexStructure() {
    const tableHead = document.querySelector("#ordersTable thead");
    if (tableHead && !tableHead.textContent.includes("完整单据回复时间")) {
        tableHead.innerHTML = `
            <tr>
                <th>流水号</th>
                <th>公司名称</th>
                <th>指令人</th>
                <th>业务类型</th>
                <th>发件人ID</th>
                <th>客户ID</th>
                <th>接收指令日期</th>
                <th>起始地</th>
                <th>目的地</th>
                <th>贸易术语</th>
                <th>货物品名</th>
                <th>提货时间</th>
                <th>开始报关时间</th>
                <th>付税时间</th>
                <th>放行时间</th>
                <th>到货时间</th>
                <th>完整单据回复时间</th>
                <th>操作</th>
            </tr>
        `;
    }

    const filterForm = document.getElementById("filterFormData");
    if (filterForm && !document.getElementById("filterCompleteDocsSendTimeFilledStatus")) {
        filterForm.innerHTML = `
            <div class="form-group">
                <label>公司名称:</label>
                <input type="text" id="filterCompanyName">
            </div>
            <div class="form-group">
                <label>指令人:</label>
                <input type="text" id="filterOrderer">
            </div>
            <div class="form-group">
                <label>业务类型:</label>
                <input type="text" id="filterBusinessType">
            </div>
            <div class="form-group">
                <label>发件人ID:</label>
                <input type="text" id="filterSenderId">
            </div>
            <div class="form-group">
                <label>客户ID:</label>
                <input type="text" id="filterCustomerId">
            </div>
            <div class="form-group">
                <label>起始地:</label>
                <input type="text" id="filterOrigin">
            </div>
            <div class="form-group">
                <label>目的地:</label>
                <input type="text" id="filterDestination">
            </div>
            <div class="form-group">
                <label>接收指令日期:</label>
                <select id="filterDateFilledStatus">
                    <option value="all">全部</option>
                    <option value="filled">已填</option>
                    <option value="unfilled">未填</option>
                </select>
            </div>
            ${buildOrderFilledStatusFilterHtml("提货时间", "filterPickupDateFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("开始报关时间", "filterCustomsStartTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("付税时间", "filterTaxPaymentTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("放行时间", "filterReleaseTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("到货时间", "filterArrivalTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("完整单据回复时间", "filterCompleteDocsSendTimeFilledStatus")}
            <div class="button-group">
                <button type="button" onclick="applyFilters()">应用筛选</button>
                <button type="button" onclick="clearFilters()">清除筛选</button>
                <button type="button" onclick="hideFilterForm()">取消</button>
            </div>
        `;
    }
}

function getFilterInputValue(id) {
    return document.getElementById(id)?.value.trim() || "";
}

// Order functions
async function loadOrders() {
    try {
        ensureOrderIndexStructure();
        const query = buildOrderFilterQuery();
        const response = await fetch(query ? `${API_BASE}/orders?${query}` : `${API_BASE}/orders`);
        const data = await response.json();
        displayOrders(data.orders);
    } catch (error) {
        showMessage("加载订单失败: " + error.message, "error");
    }
}

function displayOrders(orders) {
    // 按照流水号从高到低排序
    orders.sort((a, b) => {
        const aSerial = parseInt(a.serial_number || a.id) || 0;
        const bSerial = parseInt(b.serial_number || b.id) || 0;
        return bSerial - aSerial; // 降序排列
    });

    const tbody = document.querySelector("#ordersTable tbody");
    tbody.innerHTML = "";
    orders.forEach(order => {
        const row = tbody.insertRow();

        // 格式化日期显示
        let displayDate = "";
        if (order.receive_date) {
            try {
                let dateStr = order.receive_date;

                // 如果是ISO字符串格式（包含T），提取日期部分
                if (typeof dateStr === "string" && dateStr.includes("T")) {
                    dateStr = dateStr.split("T")[0]; // 取日期部分，格式如：2025-12-02
                }

                // 如果是YYYY-MM-DD格式，直接显示
                if (typeof dateStr === "string" && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    displayDate = dateStr.replace(/-/g, "/");
                } else {
                    // 否则使用Date对象格式化，但避免时区转换问题
                    const dateObj = new Date(dateStr);
                    if (!isNaN(dateObj.getTime())) {
                        // 使用本地日期方法，避免UTC转换
                        const year = dateObj.getFullYear();
                        const month = String(dateObj.getMonth() + 1).padStart(2, "0");
                        const day = String(dateObj.getDate()).padStart(2, "0");
                        displayDate = `${year}/${month}/${day}`;
                    }
                }
            } catch (error) {
                console.warn("日期格式化错误:", error, order.receive_date);
                displayDate = order.receive_date;
            }
        }

        displayDate = formatDateOnly(order.receive_date);

        row.innerHTML = `
            <td><button class="link-button" onclick="showOrderDetails(${order.id})">${order.serial_number || order.id}</button></td>
            <td>${order.company_name}</td>
            <td>${order.orderer}</td>
            <td>${order.business_type}</td>
            <td>${order.sender_id || ""}</td>
            <td>${order.customer_id}</td>
            <td>${displayDate}</td>
            <td>${order.origin}</td>
            <td>${order.destination}</td>
            <td>${order.trade_term || ""}</td>
            <td>${order.product_name || ""}</td>
            <td>${order.remark1 || ""}</td>
            <td>${order.remark2 || ""}</td>
            <td>
                <button onclick="editOrder(${order.id})">编辑</button>
                <button onclick="deleteOrder(${order.id})">删除</button>
            </td>
        `;
    });
}

function renderOrderDetailView(order) {
    const detailContent = document.getElementById("orderDetailContent");
    if (!detailContent) {
        showMessage("无法显示订单详情", "error");
        return;
    }

    const serialNumber = order.serial_number || order.id || "";
    currentOrderDetailSerial = serialNumber;
    const detailItems = [
        ...buildCommonOrderFieldItems(order, serialNumber),
        ["提货时间", formatDateOnly(order.pickup_date)],
        ["开始报关时间", formatDateOnly(order.customs_start_time)],
        ["付税时间", formatDateOnly(order.tax_payment_time)],
        ["放行时间", formatDateOnly(order.release_time)],
        ["到货时间", formatDateOnly(order.arrival_time)],
        ["完整单据回复时间", formatDateOnly(order.complete_docs_send_time)]
    ];

    detailContent.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(detailItems)}</div>
    `;

    const logisticsSection = document.getElementById("orderLogisticsSection");
    if (logisticsSection) {
        logisticsSection.style.display = "none";
    }

    showPage("orderDetail");
    loadOrderPackageDetails(serialNumber);
    loadOrderPickupTrackingDetails(serialNumber);
    loadOrderDeliveryTrackingDetails(serialNumber);
    loadOrderCustomsClearanceDetails(serialNumber);
}

function buildEmptyOrderForSerial(serialNumber) {
    return {
        serial_number: serialNumber || "",
        company_name: "",
        orderer: "",
        business_type: "",
        customer_id: "",
        sender_id: "",
        receive_date: "",
        origin: "",
        destination: "",
        trade_term: "",
        product_name: "",
        pickup_date: "",
        customs_start_time: "",
        tax_payment_time: "",
        release_time: "",
        arrival_time: "",
        complete_docs_send_time: "",
        remark1: "",
        remark2: "",
        shipping_address: "",
        sender_name: "",
        sender_phone: "",
        delivery_address: "",
        receiver_name: "",
        receiver_phone: ""
    };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function createEmptyPackageItem(order = 1) {
    return {
        package_label: `包装${order}`,
        package_order: order,
        box_type_id: "",
        product_name: "",
        product_code: "",
        pieces: "",
        single_weight: "",
        length: "",
        width: "",
        height: "",
        volume: "",
        charge_weight: "",
        package_type: "",
        customs_port: "",
        customs_title: "",
        regulatory_conditions: "",
        remark1: "",
        remark2: ""
    };
}

function normalizePackageItems(packageData) {
    const rawItems = Array.isArray(packageData)
        ? packageData
        : Array.isArray(packageData?.packages)
            ? packageData.packages
            : packageData
                ? [packageData]
                : [];

    if (rawItems.length === 0) {
        return [createEmptyPackageItem(1)];
    }

    return rawItems.map((item, index) => {
        const order = Number.parseInt(item.package_order, 10) || index + 1;
        return {
            ...createEmptyPackageItem(order),
            ...item,
            package_order: order,
            package_label: item.package_label || `包装${order}`
        };
    });
}

function packageItemHasContent(item) {
    return [
        item.box_type_id,
        item.product_name,
        item.product_code,
        item.pieces,
        item.single_weight,
        item.length,
        item.width,
        item.height,
        item.volume,
        item.charge_weight,
        item.package_type,
        item.customs_port,
        item.customs_title,
        item.regulatory_conditions,
        item.remark1,
        item.remark2
    ].some(value => value !== undefined && value !== null && String(value).trim() !== "");
}

function calculatePackageVolume(item) {
    const length = parseFloat(item.length);
    const width = parseFloat(item.width);
    const height = parseFloat(item.height);

    if (Number.isNaN(length) || Number.isNaN(width) || Number.isNaN(height)) {
        return "";
    }

    const volume = (length * width * height) / 1000000;
    return Number.isFinite(volume) ? volume.toFixed(4) : "";
}

function calculatePackageItemActualWeight(item) {
    const singleWeight = parseFloat(item.single_weight);
    if (Number.isNaN(singleWeight)) {
        return 0;
    }
    const pieces = parseFloat(item.pieces);
    const safePieces = Number.isNaN(pieces) || pieces <= 0 ? 1 : pieces;
    return safePieces * singleWeight;
}

function calculatePackageActualWeightTotal(items) {
    const total = (items || []).reduce((sum, item) => sum + calculatePackageItemActualWeight(item), 0);
    return total > 0 ? total.toFixed(2) : "";
}

function calculatePackagePiecesTotal(items) {
    const total = (items || []).reduce((sum, item) => {
        const pieces = parseFloat(item?.pieces);
        return sum + (Number.isNaN(pieces) ? 0 : pieces);
    }, 0);
    return total > 0 ? String(total) : "";
}

function calculatePackageVolumeTotal(items) {
    const total = (items || []).reduce((sum, item) => {
        const volume = parseFloat(item?.volume || calculatePackageVolume(item));
        return sum + (Number.isNaN(volume) ? 0 : volume);
    }, 0);
    return total > 0 ? total.toFixed(4) : "";
}

function getPackageChargeWeightValue(items) {
    const chargeWeight = (items || []).find(item => {
        const value = item?.charge_weight;
        return value !== undefined && value !== null && String(value).trim() !== "";
    })?.charge_weight;
    const parsed = parseFloat(chargeWeight);
    return Number.isNaN(parsed) ? (chargeWeight || "") : parsed.toFixed(2);
}

function calculatePackageChargeWeightTotal(items) {
    return getPackageChargeWeightValue(items);
}

function formatPackageItemSummary(items, field) {
    const values = items
        .filter(packageItemHasContent)
        .map(item => {
            const value = item[field];
            if (value === undefined || value === null || String(value).trim() === "") {
                return "";
            }
            return `${escapeHtml(value)}`;
        })
        .filter(Boolean);

    return values.join("<br>") || "";
}

function buildDetailGridItems(items) {
    return items.map(([label, value]) => `<div><strong>${label}:</strong> ${escapeHtml(value || "")}</div>`).join("");
}

function getOrderDisplayOrigin(record) {
    return record?.order_origin || record?.origin || "";
}

function getOrderDisplayDestination(record) {
    return record?.order_destination || record?.destination || "";
}

function getOrderDisplayProductName(record) {
    return record?.order_product_name || record?.product_name || "";
}

function buildCommonOrderFieldItems(record, serialNumber = "") {
    return [
        ["流水号", serialNumber || record?.serial_number || record?.id || ""],
        ["公司名称", record?.company_name || ""],
        ["指令人", record?.orderer || ""],
        ["业务类型", record?.business_type || ""],
        ["发件人ID", record?.sender_id || ""],
        ["客户ID", record?.customer_id || ""],
        ["接收指令日期", formatDateOnly(record?.receive_date)],
        ["起始地", getOrderDisplayOrigin(record)],
        ["目的地", getOrderDisplayDestination(record)],
        ["贸易术语", record?.trade_term || ""],
        ["货物品名", getOrderDisplayProductName(record)]
    ];
}

function getSharedTrackingFieldValue(record, fieldName) {
    const definition = SHARED_TRACKING_FIELD_DEFINITIONS[fieldName];
    if (!definition) {
        return "";
    }

    const rawValue = typeof definition.getValue === "function"
        ? definition.getValue(record || {})
        : record?.[fieldName];

    return rawValue ?? "";
}

function buildSharedTrackingDetailItems(record, fieldNames) {
    return fieldNames
        .filter(fieldName => SHARED_TRACKING_FIELD_DEFINITIONS[fieldName])
        .map(fieldName => [
            SHARED_TRACKING_FIELD_DEFINITIONS[fieldName].label,
            getSharedTrackingFieldValue(record, fieldName)
        ]);
}

function fillSharedFormFields(form, fieldMap, data = {}) {
    Object.entries(fieldMap).forEach(([fieldName, selector]) => {
        const element = form.querySelector(selector);
        if (element) {
            element.value = getSharedTrackingFieldValue(data, fieldName);
        }
    });
}

function clearSharedFormFields(form, fieldMap) {
    Object.values(fieldMap).forEach(selector => {
        const element = form.querySelector(selector);
        if (element) {
            element.value = "";
        }
    });
}

function collectSharedFormPayload(form, fieldMap, options = {}) {
    const { trim = false, nullIfEmpty = false } = options;
    return Object.entries(fieldMap).reduce((payload, [fieldName, selector]) => {
        const element = form.querySelector(selector);
        if (!element) {
            return payload;
        }

        let value = element.value;
        if (trim && typeof value === "string") {
            value = value.trim();
        }

        payload[fieldName] = nullIfEmpty && value === "" ? null : value;
        return payload;
    }, {});
}

function refreshTrackingLinkedViews(serialNumber) {
    loadPickupTrackings();
    loadTransfers();
    loadCustomsClearance();
    loadPackages();

    if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
        loadOrderPackageDetails(serialNumber);
        loadOrderPickupTrackingDetails(serialNumber);
        loadOrderDeliveryTrackingDetails(serialNumber);
        loadOrderCustomsClearanceDetails(serialNumber);
    }
}

function groupPackagesBySerial(packages) {
    const grouped = new Map();

    (packages || []).forEach(pkg => {
        const serialNumber = pkg.serial_number || "";
        if (!grouped.has(serialNumber)) {
            grouped.set(serialNumber, {
                serial_number: serialNumber,
                company_name: pkg.company_name || "",
                orderer: pkg.orderer || "",
                business_type: pkg.business_type || "",
                sender_id: pkg.sender_id || "",
                customer_id: pkg.customer_id || "",
                receive_date: pkg.receive_date || "",
                origin: pkg.origin || "",
                destination: pkg.destination || "",
                trade_term: pkg.trade_term || "",
                order_product_name: pkg.order_product_name || pkg.product_name || "",
                transport_mode: pkg.transport_mode || "",
                tracking_number: pkg.tracking_number || "",
                packages: []
            });
        }
        grouped.get(serialNumber).packages.push(pkg);
    });

    return Array.from(grouped.values()).map(group => ({
        ...group,
        packages: normalizePackageItems(group.packages)
    }));
}

function renderOrderPackageContent(serialNumber, packageData) {
    const packageContent = document.getElementById("orderPackageContent");
    if (!packageContent) {
        return;
    }

    const packageItems = normalizePackageItems(packageData);
    const meaningfulItems = packageItems.filter(packageItemHasContent);
    currentOrderPackageData = packageItems.map(item => ({ ...item, serial_number: serialNumber }));
    const summaryRecord = meaningfulItems[0] || packageItems[0] || {};
    const actualWeightTotal = calculatePackageActualWeightTotal(meaningfulItems);
    const piecesTotal = calculatePackagePiecesTotal(meaningfulItems);
    const volumeTotal = calculatePackageVolumeTotal(meaningfulItems);
    const chargeWeightValue = getPackageChargeWeightValue(meaningfulItems);
    const summaryItems = [
        ...buildCommonOrderFieldItems(summaryRecord, serialNumber),
        ["运输方式", summaryRecord.transport_mode || ""],
        ["运单号", summaryRecord.tracking_number || ""],
        ["件数", piecesTotal],
        ["重量", actualWeightTotal || ""],
        ["体积", volumeTotal || ""],
        ["计费重量", chargeWeightValue || ""]
    ];

    packageContent.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(summaryItems)}</div>
    `;
}

async function loadOrderPackageDetails(serialNumber) {
    const packageContent = document.getElementById("orderPackageContent");
    if (!packageContent) {
        return;
    }

    currentOrderPackageData = null;
    if (!serialNumber) {
        renderOrderPackageContent("", null);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`);
        if (!response.ok) {
            if (response.status === 404) {
                renderOrderPackageContent(serialNumber, null);
                return;
            }
            const errorData = await response.json();
            showMessage(errorData.error || "加载包装信息失败", "error");
            renderOrderPackageContent(serialNumber, null);
            return;
        }
        const data = await response.json();
        renderOrderPackageContent(serialNumber, data.packages || data.package || null);
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
        renderOrderPackageContent(serialNumber, null);
    }
}

function openPackageFormFromOrderDetail() {
    if (!currentOrderDetailSerial) {
        showMessage("未找到订单流水号", "error");
        return;
    }

    if (currentOrderPackageData && currentOrderPackageData.length > 0) {
        showPackageForm({
            serial_number: currentOrderDetailSerial,
            packages: currentOrderPackageData
        });
        return;
    }

    showPackageForm({
        serial_number: currentOrderDetailSerial,
        packages: [createEmptyPackageItem(1)]
    });
}

function renderOrderPickupTrackingContent(serialNumber, trackingData) {
    const trackingContent = document.getElementById("orderPickupTrackingContent");
    if (!trackingContent) {
        return;
    }

    currentOrderPickupTrackingData = trackingData ? { ...trackingData, serial_number: serialNumber } : null;
    const hasTracking = Boolean(trackingData);
    const info = trackingData || {};
    const detailItems = [
        ...buildCommonOrderFieldItems(info, serialNumber),
        ["运输方式", info.transport_mode || ""],
        ["报关口岸", info.customs_port || ""],
        ["提货日期", formatDateOnly(info.pickup_date)],
        ["到货时间", formatDateOnly(info.arrival_time)],
        ...buildSharedTrackingDetailItems(info, [
            "tracking_number",
            "transport_supplier",
            "contract_number",
            "cargo_flow_info",
            "value_added_services",
            "remark1",
            "remark2"
        ])
    ];

    trackingContent.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(detailItems)}</div>
    `;
}

async function loadOrderPickupTrackingDetails(serialNumber) {
    const trackingContent = document.getElementById("orderPickupTrackingContent");
    if (!trackingContent) {
        return;
    }

    currentOrderPickupTrackingData = null;
    if (!serialNumber) {
        renderOrderPickupTrackingContent("", null);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/pickup-trackings/serial/${encodeURIComponent(serialNumber)}`);
        if (!response.ok) {
            if (response.status === 404) {
                renderOrderPickupTrackingContent(serialNumber, null);
                return;
            }
            const errorData = await response.json();
            showMessage(errorData.error || "加载提货运输跟踪信息失败", "error");
            renderOrderPickupTrackingContent(serialNumber, null);
            return;
        }
        const data = await response.json();
        renderOrderPickupTrackingContent(serialNumber, data.pickupTracking || null);
    } catch (error) {
        showMessage("加载提货运输跟踪信息失败: " + error.message, "error");
        renderOrderPickupTrackingContent(serialNumber, null);
    }
}

function openPickupTrackingFormFromOrderDetail() {
    if (!currentOrderDetailSerial) {
        showMessage("未找到订单流水号", "error");
        return;
    }

    if (currentOrderPickupTrackingData) {
        showPickupTrackingForm(currentOrderPickupTrackingData);
        return;
    }

    showPickupTrackingForm({ serial_number: currentOrderDetailSerial });
}

function renderOrderDeliveryTrackingContent(serialNumber, deliveryData) {
    const deliveryContent = document.getElementById("orderDeliveryTrackingContent");
    if (!deliveryContent) {
        return;
    }

    currentOrderDeliveryTrackingData = deliveryData ? { ...deliveryData, serial_number: serialNumber } : null;
    const hasDelivery = Boolean(deliveryData);
    const info = deliveryData || {};
    const detailItems = [
        ...buildCommonOrderFieldItems(info, serialNumber),
        ["运输方式", info.transport_mode || ""],
        ["提货日期", formatDateOnly(info.pickup_date)],
        ["到货时间", formatDateOnly(info.arrival_port_time)],
        ["完整单据回复时间", formatDateOnly(info.complete_docs_send_time)],
        ...buildSharedTrackingDetailItems(info, [
            "tracking_number",
            "transport_supplier",
            "cargo_flow_info",
            "remark1",
            "remark2"
        ])
    ];

    deliveryContent.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(detailItems)}</div>
    `;
}

function renderOrderLogisticsContent(serialNumber, logisticsData) {
    const logisticsContent = document.getElementById("orderLogisticsContent");
    if (!logisticsContent) {
        return;
    }

    const info = logisticsData || {};
    const detailItems = [
        ...buildCommonOrderFieldItems(info, serialNumber),
        ["运输方式", info.transport_mode || ""],
        ["提货日期", formatDateOnly(info.pickup_date)],
        ["到货时间", formatDateOnly(info.arrival_port_time)],
        ["完整单据回复时间", formatDateOnly(info.complete_docs_send_time)],
        ...buildSharedTrackingDetailItems(info, [
            "tracking_number",
            "transport_supplier",
            "cargo_flow_info",
            "value_added_services",
            "remark1",
            "remark2"
        ])
    ];

    logisticsContent.innerHTML = `<div class="detail-grid">${buildDetailGridItems(detailItems)}</div>`;
}

async function loadOrderDeliveryTrackingDetails(serialNumber) {
    const deliveryContent = document.getElementById("orderDeliveryTrackingContent");
    if (!deliveryContent) {
        return;
    }

    currentOrderDeliveryTrackingData = null;
    if (!serialNumber) {
        renderOrderDeliveryTrackingContent("", null);
        renderOrderLogisticsContent("", null);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/transfers/serial/${encodeURIComponent(serialNumber)}`);
        if (!response.ok) {
            if (response.status === 404) {
                renderOrderDeliveryTrackingContent(serialNumber, null);
                renderOrderLogisticsContent(serialNumber, null);
                return;
            }
            const errorData = await response.json();
            showMessage(errorData.error || "加载送货运输跟踪信息失败", "error");
            renderOrderDeliveryTrackingContent(serialNumber, null);
            renderOrderLogisticsContent(serialNumber, null);
            return;
        }
        const data = await response.json();
        renderOrderDeliveryTrackingContent(serialNumber, data.transfer || null);
        renderOrderLogisticsContent(serialNumber, data.transfer || null);
    } catch (error) {
        showMessage("加载送货运输跟踪信息失败: " + error.message, "error");
        renderOrderDeliveryTrackingContent(serialNumber, null);
        renderOrderLogisticsContent(serialNumber, null);
    }
}

function openTransferFormFromOrderDetail() {
    if (!currentOrderDetailSerial) {
        showMessage("未找到订单流水号", "error");
        return;
    }

    if (currentOrderDeliveryTrackingData) {
        showTransferForm(currentOrderDeliveryTrackingData);
        return;
    }

    showTransferForm({ serial_number: currentOrderDetailSerial });
}

function renderOrderCustomsClearanceContent(serialNumber, customsData) {
    const customsContent = document.getElementById("orderCustomsClearanceContent");
    if (!customsContent) {
        return;
    }

    currentOrderCustomsClearanceData = customsData ? { ...customsData, serial_number: serialNumber } : null;
    const hasCustoms = Boolean(customsData);
    const info = customsData || {};
    const detailItems = [
        ...buildCommonOrderFieldItems(info, serialNumber),
        ["运输方式", info.transport_mode || ""],
        ["开始报关时间", formatDateOnly(info.customs_start_time)],
        ["付税时间", formatDateOnly(info.tax_payment_time)],
        ["放行时间", formatDateOnly(info.release_time)],
        ...buildSharedTrackingDetailItems(info, [
            "tracking_number",
            "customs_declaration_number",
            "customs_supplier",
            "remark1",
            "remark2"
        ])
    ];

    customsContent.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(detailItems)}</div>
    `;
}

async function loadOrderCustomsClearanceDetails(serialNumber) {
    const customsContent = document.getElementById("orderCustomsClearanceContent");
    if (!customsContent) {
        return;
    }

    currentOrderCustomsClearanceData = null;
    if (!serialNumber) {
        renderOrderCustomsClearanceContent("", null);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/customs-clearance/serial/${encodeURIComponent(serialNumber)}`);
        if (!response.ok) {
            if (response.status === 404) {
                renderOrderCustomsClearanceContent(serialNumber, null);
                return;
            }
            const errorData = await response.json();
            showMessage(errorData.error || "加载报关信息失败", "error");
            renderOrderCustomsClearanceContent(serialNumber, null);
            return;
        }
        const data = await response.json();
        renderOrderCustomsClearanceContent(serialNumber, data.record || null);
    } catch (error) {
        showMessage("加载报关信息失败: " + error.message, "error");
        renderOrderCustomsClearanceContent(serialNumber, null);
    }
}

function openCustomsFormFromOrderDetail() {
    if (!currentOrderDetailSerial) {
        showMessage("未找到订单流水号", "error");
        return;
    }

    if (currentOrderCustomsClearanceData) {
        showCustomsForm(currentOrderCustomsClearanceData);
        return;
    }

    showCustomsForm({ serial_number: currentOrderDetailSerial });
}

async function showOrderDetails(id) {
    try {
        const response = await fetch(`${API_BASE}/orders/${id}`);
        const data = await response.json();
        if (!response.ok || !data.order) {
            showMessage(data.error || "加载订单详情失败", "error");
            return;
        }
        renderOrderDetailView(data.order);
    } catch (error) {
        showMessage("加载订单详情失败: " + error.message, "error");
    }
}

async function showOrderDetailsBySerial(serialNumber) {
    try {
        const response = await fetch(`${API_BASE}/orders/serial/${encodeURIComponent(serialNumber)}`);
        if (response.status === 404) {
            renderOrderDetailView(buildEmptyOrderForSerial(serialNumber));
            return;
        }
        const data = await response.json();
        if (!response.ok || !data.order) {
            showMessage(data.error || "加载订单详情失败", "error");
            return;
        }
        renderOrderDetailView(data.order);
    } catch (error) {
        showMessage("加载订单详情失败: " + error.message, "error");
    }
}

function showOrderForm(order = null) {
    const modal = document.getElementById("orderModal");
    const modalTitle = document.getElementById("orderModalTitle");
    const form = modal.querySelector("#orderFormData");

    if (order) {
        modalTitle.textContent = "编辑订单";
        if (form) {
            form.querySelector("#companyName").value = order.company_name || "";
            form.querySelector("#orderer").value = order.orderer || "";
            setReceiveDateValue(order.receive_date ? order.receive_date.split("T")[0] : "", form);
            form.querySelector("#businessType").value = order.business_type || "";
            form.querySelector("#customerId").value = order.customer_id || "";
            form.querySelector("#senderId").value = order.sender_id || "";
            form.querySelector("#shippingAddress").value = order.shipping_address || "";
            form.querySelector("#senderName").value = order.sender_name || "";
            form.querySelector("#senderPhone").value = order.sender_phone || "";
            form.querySelector("#deliveryAddress").value = order.delivery_address || "";
            form.querySelector("#receiverName").value = order.receiver_name || "";
            form.querySelector("#receiverPhone").value = order.receiver_phone || "";
            form.querySelector("#origin").value = order.origin || "";
            form.querySelector("#destination").value = order.destination || "";
            form.querySelector("#tradeTerm").value = order.trade_term || "";
            form.querySelector("#productName").value = order.product_name || "";
            form.querySelector("#orderRemark1").value = order.remark1 || "";
            form.querySelector("#orderRemark2").value = order.remark2 || "";
            form.dataset.editId = order.id;
        }
    } else {
        modalTitle.textContent = "新增订单";
        if (form) {
            form.reset();
            resetReceiveDateInputs(form);
            if (form.dataset) {
                delete form.dataset.editId;
            }
        } else {
            clearForms();
        }
    }
    
    // 为customerId和senderId添加自动填充事件
    if (form) {
        const customerIdInput = form.querySelector("#customerId");
        const senderIdInput = form.querySelector("#senderId");
        
        if (customerIdInput) {
            customerIdInput.removeEventListener("change", handleCustomerIdChange);
            customerIdInput.addEventListener("change", handleCustomerIdChange);
        }
        
        if (senderIdInput) {
            senderIdInput.removeEventListener("change", handleSenderIdChange);
            senderIdInput.addEventListener("change", handleSenderIdChange);
        }
    }
    
    modal.style.display = "block";
}

function handleCustomerIdChange(event) {
    const customerId = event.target.value.trim();
    if (!customerId) {
        return;
    }
    
    // 从customersData中查找对应的客户信息
    const customer = userProfilesData.find(profile => profile.id === customerId);
    if (customer) {
        const form = event.target.closest("#orderFormData");
        if (form) {
            form.querySelector("#deliveryAddress").value = customer.address || "";
            form.querySelector("#receiverName").value = customer.contact_name || "";
            form.querySelector("#receiverPhone").value = customer.phone || "";
        }
    }
}

function handleSenderIdChange(event) {
    const senderId = event.target.value.trim();
    if (!senderId) {
        return;
    }
    
    // 从sendersData中查找对应的发件人信息
    const sender = sendersData.find(s => s.sender_id === senderId);
    if (sender) {
        const form = event.target.closest("#orderFormData");
        if (form) {
            form.querySelector("#shippingAddress").value = sender.address || "";
            form.querySelector("#senderName").value = sender.contact_name || "";
            form.querySelector("#senderPhone").value = sender.phone || "";
        }
    }
}

function hideOrderForm() {
    document.getElementById("orderModal").style.display = "none";
    clearForms();
    // 清空导入消息和文件选择
    document.getElementById("importMessage").innerHTML = "";
    document.getElementById("excelFile").value = "";
}

// Excel预览功能 - 预览第一行数据
async function previewExcel() {
    const fileInput = document.getElementById("excelFile");
    const importMessage = document.getElementById("importMessage");

    if (!fileInput.files || fileInput.files.length === 0) {
        showImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showImportMessage("正在解析Excel文件...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到后端API
        const response = await fetch(`${API_BASE}/orders/parse-excel`, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // 自动填充表单（打开新增订单弹窗）
            showOrderForm();
            fillFormWithData(result.data);
            showImportMessage("数据预览成功！请检查并确认信息后保存或进行批量导入。", "success");
        } else {
            // 显示错误信息
            const errorMessage = result.details ? result.details.join("<br>") : (result.error || "预览失败");
            showImportMessage(errorMessage, "error");
        }

    } catch (error) {
        showImportMessage("网络错误: " + error.message, "error");
    }
}

// Excel批量导入功能 - 导入多行数据
async function importExcelBatch() {
    const fileInput = document.getElementById("excelFile");
    const importMessage = document.getElementById("importMessage");
    const importResults = document.getElementById("importResults");

    if (!fileInput.files || fileInput.files.length === 0) {
        showImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showImportMessage("正在批量导入Excel数据...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到批量导入API
        const response = await fetch(`${API_BASE}/orders/import-excel`, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            // 显示导入结果
            displayImportResults(result);
            showImportMessage(result.message, result.success ? "success" : "error");

            // 如果有成功导入的记录，刷新订单列表
            if (result.results && result.results.success > 0) {
                loadOrders();
            }
        } else {
            showImportMessage(result.error || "批量导入失败", "error");
        }

    } catch (error) {
        showImportMessage("网络错误: " + error.message, "error");
    }
}

// 显示导入结果
function displayImportResults(result) {
    const importResults = document.getElementById("importResults");
    const importSummary = document.getElementById("importSummary");
    const importErrors = document.getElementById("importErrors");

    if (result.results) {
        // 显示汇总信息
        importSummary.innerHTML = `
            <p><strong>总行数:</strong> ${result.results.total}</p>
            <p><strong>成功导入:</strong> ${result.results.success}</p>
            <p><strong>导入失败:</strong> ${result.results.failed}</p>
        `;

        // 显示错误详情
        if (result.results.errors && result.results.errors.length > 0) {
            let errorHtml = "<h6>错误详情:</h6><ul>";
            result.results.errors.forEach(error => {
                errorHtml += `<li><strong>第${error.row}行:</strong> ${error.errors.join(", ")}</li>`;
            });
            errorHtml += "</ul>";
            importErrors.innerHTML = errorHtml;
        } else {
            importErrors.innerHTML = "";
        }

        importResults.style.display = "block";
    } else {
        importResults.style.display = "none";
    }
}

function fillFormWithData(data) {
    const fieldMapping = {
        company_name: "companyName",
        orderer: "orderer",
        receive_date: "receiveDate",
        business_type: "businessType",
        sender_id: "senderId",
        customer_id: "customerId",
        shipping_address: "shippingAddress",
        sender_name: "senderName",
        sender_phone: "senderPhone",
        delivery_address: "deliveryAddress",
        receiver_name: "receiverName",
        receiver_phone: "receiverPhone",
        origin: "origin",
        destination: "destination",
        trade_term: "tradeTerm",
        product_name: "productName",
        remark1: "orderRemark1",
        remark2: "orderRemark2"
    };

    for (const [dbField, formField] of Object.entries(fieldMapping)) {
        if (data[dbField] !== undefined) {
            if (dbField === "receive_date") {
                setReceiveDateValue(data[dbField]);
                continue;
            }
            const element = getOrderFormElement(formField);
            if (element) {
                element.value = data[dbField];
            }
        }
    }
}

function showImportMessage(message, type = "info") {
    const importMessage = document.getElementById("importMessage");
    importMessage.innerHTML = message;
    importMessage.className = type;
}

async function downloadOrderImportTemplate() {
    try {
        const response = await fetch(`${API_BASE}/orders/import-template`);
        if (!response.ok) {
            const error = await response.json();
            showImportMessage(error.error || "下载模板失败", "error");
            return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "order_import_template.xlsx";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showImportMessage("导入模板下载成功", "success");
    } catch (error) {
        showImportMessage("下载模板失败: " + error.message, "error");
    }
}

async function saveOrder() {
    const form = getVisibleOrderForm() || document.getElementById("orderFormData");
    if (!form) {
        showMessage("未找到订单表单", "error");
        return;
    }
    const orderData = {
        company_name: getOrderFormElement("companyName", form).value,
        orderer: getOrderFormElement("orderer", form).value,
        receive_date: getReceiveDateValue(form),
        business_type: getOrderFormElement("businessType", form).value,
        sender_id: getOrderFormElement("senderId", form).value,
        customer_id: getOrderFormElement("customerId", form).value,
        shipping_address: getOrderFormElement("shippingAddress", form).value,
        sender_name: getOrderFormElement("senderName", form).value,
        sender_phone: getOrderFormElement("senderPhone", form).value,
        delivery_address: getOrderFormElement("deliveryAddress", form).value,
        receiver_name: getOrderFormElement("receiverName", form).value,
        receiver_phone: getOrderFormElement("receiverPhone", form).value,
        origin: getOrderFormElement("origin", form).value,
        destination: getOrderFormElement("destination", form).value,
        trade_term: getOrderFormElement("tradeTerm", form).value,
        product_name: getOrderFormElement("productName", form).value,
        remark1: getOrderFormElement("orderRemark1", form).value,
        remark2: getOrderFormElement("orderRemark2", form).value
    };

    try {
        let response;
        if (form.dataset.editId) {
            response = await fetch(`${API_BASE}/orders/${form.dataset.editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(orderData)
            });
        } else {
            response = await fetch(`${API_BASE}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(orderData)
            });
        }

        if (response.ok) {
            showMessage("订单保存成功");
            // 保存成功后关闭弹窗并刷新列表
            const addOrdersPage = document.getElementById("addOrdersPage");
            if (addOrdersPage && addOrdersPage.style.display === "block") {
                clearOrderForm();
            } else {
                hideOrderForm();
            }
            loadOrders();
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

async function editOrder(id) {
    try {
        const response = await fetch(`${API_BASE}/orders/${id}`);
        const data = await response.json();
        showOrderForm(data.order);
    } catch (error) {
        showMessage("加载订单失败: " + error.message, "error");
    }
}

async function deleteOrder(id) {
    if (confirm("确定删除此订单吗？")) {
        try {
            const response = await fetch(`${API_BASE}/orders/${id}`, { method: "DELETE" });
            if (response.ok) {
                showMessage("订单删除成功");
                loadOrders();
            } else {
                const error = await response.json();
                showMessage("删除失败: " + error.error, "error");
            }
        } catch (error) {
            showMessage("删除失败: " + error.message, "error");
        }
    }
}

// Filter and search functions
function showFilterForm() {
    document.getElementById("filterModal").style.display = "block";
}

function hideFilterForm() {
    document.getElementById("filterModal").style.display = "none";
}

function applyFilters() {
    // Get filter values
    currentFilters = {
        company_name: document.getElementById("filterCompanyName").value.trim(),
        orderer: document.getElementById("filterOrderer").value.trim(),
        business_type: document.getElementById("filterBusinessType").value.trim(),
        sender_id: document.getElementById("filterSenderId").value.trim(),
        customer_id: document.getElementById("filterCustomerId").value.trim(),
        origin: document.getElementById("filterOrigin").value.trim(),
        destination: document.getElementById("filterDestination").value.trim(),
        dateFilledStatus: document.getElementById("filterDateFilledStatus").value
    };

    Object.keys(currentFilters).forEach(key => {
        if (currentFilters[key] === "" || currentFilters[key] === "all") {
            delete currentFilters[key];
        }
    });

    // Load and filter orders
    loadAndFilterOrders();
    hideFilterForm();
}

function clearFilters() {
    // Clear filter form
    document.getElementById("filterFormData").reset();
    const dateFilledStatus = document.getElementById("filterDateFilledStatus");
    if (dateFilledStatus) {
        dateFilledStatus.value = "all";
    }
    // Clear current filters
    currentFilters = {};
    // Clear search term as well
    currentSearchTerm = "";
    document.getElementById("searchInput").value = "";
    // Reload all orders
    loadOrders();
    hideFilterForm();
}

function searchOrders() {
    currentSearchTerm = document.getElementById("searchInput").value.trim();
    loadAndFilterOrders();
}

function buildOrderFilterQuery() {
    const params = new URLSearchParams();

    Object.entries(currentFilters || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            params.set(key, value);
        }
    });

    return params.toString();
}

async function loadAndFilterOrders() {
    try {
        const query = buildOrderFilterQuery();
        const response = await fetch(query ? `${API_BASE}/orders?${query}` : `${API_BASE}/orders`);
        const data = await response.json();

        let filteredOrders = data.orders;

        // Apply search term (if any)
        if (currentSearchTerm) {
            filteredOrders = filteredOrders.filter(order => {
                const searchLower = currentSearchTerm.toLowerCase();
                return (
                    (order.serial_number && order.serial_number.toString().toLowerCase().includes(searchLower)) ||
                    order.company_name.toLowerCase().includes(searchLower) ||
                    order.orderer.toLowerCase().includes(searchLower) ||
                    order.business_type.toLowerCase().includes(searchLower) ||
                    order.customer_id.toLowerCase().includes(searchLower) ||
                    (order.sender_id && order.sender_id.toLowerCase().includes(searchLower)) ||
                    order.origin.toLowerCase().includes(searchLower) ||
                    order.destination.toLowerCase().includes(searchLower) ||
                    (order.trade_term && order.trade_term.toLowerCase().includes(searchLower)) ||
                    (order.product_name && order.product_name.toLowerCase().includes(searchLower))
                );
            });
        }

        displayOrders(filteredOrders);
    } catch (error) {
        showMessage("加载订单失败: " + error.message, "error");
    }
}

function ensureOrderIndexStructure() {
    const tableHead = document.querySelector("#ordersTable thead");
    if (tableHead && !tableHead.textContent.includes("完整单据回复时间")) {
        tableHead.innerHTML = `
            <tr>
                <th>流水号</th>
                <th>公司名称</th>
                <th>指令人</th>
                <th>业务类型</th>
                <th>发件人ID</th>
                <th>客户ID</th>
                <th>接收指令日期</th>
                <th>起始地</th>
                <th>目的地</th>
                <th>贸易术语</th>
                <th>货物品名</th>
                <th>提货时间</th>
                <th>开始报关时间</th>
                <th>付税时间</th>
                <th>放行时间</th>
                <th>到货时间</th>
                <th>完整单据回复时间</th>
                <th>操作</th>
            </tr>
        `;
    }

    const filterForm = document.getElementById("filterFormData");
    if (filterForm && !document.getElementById("filterCompleteDocsSendTimeFilledStatus")) {
        filterForm.innerHTML = `
            <div class="form-group">
                <label>公司名称:</label>
                <input type="text" id="filterCompanyName">
            </div>
            <div class="form-group">
                <label>指令人:</label>
                <input type="text" id="filterOrderer">
            </div>
            <div class="form-group">
                <label>业务类型:</label>
                <input type="text" id="filterBusinessType">
            </div>
            <div class="form-group">
                <label>发件人ID:</label>
                <input type="text" id="filterSenderId">
            </div>
            <div class="form-group">
                <label>客户ID:</label>
                <input type="text" id="filterCustomerId">
            </div>
            <div class="form-group">
                <label>起始地:</label>
                <input type="text" id="filterOrigin">
            </div>
            <div class="form-group">
                <label>目的地:</label>
                <input type="text" id="filterDestination">
            </div>
            <div class="form-group">
                <label>接收指令日期:</label>
                <select id="filterDateFilledStatus">
                    <option value="all">全部</option>
                    <option value="filled">已填</option>
                    <option value="unfilled">未填</option>
                </select>
            </div>
            ${buildOrderFilledStatusFilterHtml("提货时间", "filterPickupDateFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("开始报关时间", "filterCustomsStartTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("付税时间", "filterTaxPaymentTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("放行时间", "filterReleaseTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("到货时间", "filterArrivalTimeFilledStatus")}
            ${buildOrderFilledStatusFilterHtml("完整单据回复时间", "filterCompleteDocsSendTimeFilledStatus")}
            <div class="button-group">
                <button type="button" onclick="applyFilters()">应用筛选</button>
                <button type="button" onclick="clearFilters()">清除筛选</button>
                <button type="button" onclick="hideFilterForm()">取消</button>
            </div>
        `;
    }
}

function displayOrders(orders) {
    ensureOrderIndexStructure();

    orders.sort((a, b) => {
        const aSerial = parseInt(a.serial_number || a.id) || 0;
        const bSerial = parseInt(b.serial_number || b.id) || 0;
        return bSerial - aSerial;
    });

    const tbody = document.querySelector("#ordersTable tbody");
    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";
    orders.forEach(order => {
        const row = tbody.insertRow();
        const displayDate = formatDateOnly(order.receive_date);

        row.innerHTML = `
            <td><button class="link-button" onclick="showOrderDetails(${order.id})">${order.serial_number || order.id}</button></td>
            <td>${order.company_name || ""}</td>
            <td>${order.orderer || ""}</td>
            <td>${order.business_type || ""}</td>
            <td>${order.sender_id || ""}</td>
            <td>${order.customer_id || ""}</td>
            <td>${displayDate}</td>
            <td>${order.origin || ""}</td>
            <td>${order.destination || ""}</td>
            <td>${order.trade_term || ""}</td>
            <td>${order.product_name || ""}</td>
            <td>${formatDateOnly(order.pickup_date)}</td>
            <td>${formatDateOnly(order.customs_start_time)}</td>
            <td>${formatDateOnly(order.tax_payment_time)}</td>
            <td>${formatDateOnly(order.release_time)}</td>
            <td>${formatDateOnly(order.arrival_time)}</td>
            <td>${formatDateOnly(order.complete_docs_send_time)}</td>
            <td>
                <button onclick="editOrder(${order.id})">编辑</button>
                <button onclick="deleteOrder(${order.id})">删除</button>
            </td>
        `;
    });
}

function showFilterForm() {
    ensureOrderIndexStructure();
    document.getElementById("filterModal").style.display = "block";
}

function applyFilters() {
    ensureOrderIndexStructure();
    currentFilters = {
        company_name: getFilterInputValue("filterCompanyName"),
        orderer: getFilterInputValue("filterOrderer"),
        business_type: getFilterInputValue("filterBusinessType"),
        sender_id: getFilterInputValue("filterSenderId"),
        customer_id: getFilterInputValue("filterCustomerId"),
        origin: getFilterInputValue("filterOrigin"),
        destination: getFilterInputValue("filterDestination"),
        pickup_date_filled_status: getFilterInputValue("filterPickupDateFilledStatus"),
        customs_start_time_filled_status: getFilterInputValue("filterCustomsStartTimeFilledStatus"),
        tax_payment_time_filled_status: getFilterInputValue("filterTaxPaymentTimeFilledStatus"),
        release_time_filled_status: getFilterInputValue("filterReleaseTimeFilledStatus"),
        arrival_time_filled_status: getFilterInputValue("filterArrivalTimeFilledStatus"),
        complete_docs_send_time_filled_status: getFilterInputValue("filterCompleteDocsSendTimeFilledStatus"),
        dateFilledStatus: document.getElementById("filterDateFilledStatus")?.value || "all"
    };

    Object.keys(currentFilters).forEach(key => {
        if (currentFilters[key] === "" || currentFilters[key] === "all") {
            delete currentFilters[key];
        }
    });

    loadAndFilterOrders();
    hideFilterForm();
}

function clearFilters() {
    ensureOrderIndexStructure();
    document.getElementById("filterFormData")?.reset();
    const dateFilledStatus = document.getElementById("filterDateFilledStatus");
    if (dateFilledStatus) {
        dateFilledStatus.value = "all";
    }
    currentFilters = {};
    currentSearchTerm = "";
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.value = "";
    }
    loadOrders();
    hideFilterForm();
}

async function loadAndFilterOrders() {
    try {
        ensureOrderIndexStructure();
        const query = buildOrderFilterQuery();
        const response = await fetch(query ? `${API_BASE}/orders?${query}` : `${API_BASE}/orders`);
        const data = await response.json();

        let filteredOrders = data.orders || [];

        if (currentSearchTerm) {
            const searchLower = currentSearchTerm.toLowerCase();
            filteredOrders = filteredOrders.filter(order => {
                return [
                    order.serial_number,
                    order.company_name,
                    order.orderer,
                    order.business_type,
                    order.customer_id,
                    order.sender_id,
                    order.origin,
                    order.destination,
                    order.trade_term,
                    order.product_name
                ].some(value => value && String(value).toLowerCase().includes(searchLower));
            });
        }

        displayOrders(filteredOrders);
    } catch (error) {
        showMessage("加载订单失败: " + error.message, "error");
    }
}

// User functions
async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/users`);
        const data = await response.json();
        displayUsers(data.users);
    } catch (error) {
        showMessage("加载用户失败: " + error.message, "error");
    }
}

function displayUsers(users) {
    const tbody = document.querySelector("#usersTable tbody");
    tbody.innerHTML = "";
    users.forEach(user => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.role}</td>
            <td>${new Date(user.created_at).toLocaleString()}</td>
            <td>
                <button onclick="editUser(${user.id})">编辑</button>
                <button onclick="deleteUser(${user.id})">删除</button>
            </td>
        `;
    });
}

function showUserForm(user = null) {
    const form = document.getElementById("userForm");
    if (user) {
        document.getElementById("username").value = user.username;
        document.getElementById("password").value = ""; // Don't show password
        document.getElementById("userRole").value = user.role;
        setReceiveDateValue(order.receive_date ? order.receive_date.split("T")[0] : "");
    } else {
        clearForms();
        delete form.dataset.editId;
    }
    form.style.display = "block";
}

function hideUserForm() {
    document.getElementById("userForm").style.display = "none";
    clearForms();
}

async function saveUser() {
    const form = document.getElementById("userForm");
    const userData = {
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
        role: document.getElementById("userRole").value
    };

    try {
        let response;
        if (form.dataset.editId) {
            response = await fetch(`${API_BASE}/users/${form.dataset.editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userData)
            });
        } else {
            response = await fetch(`${API_BASE}/users`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userData)
            });
        }

        if (response.ok) {
            showMessage("用户保存成功");
            hideUserForm();
            loadUsers();
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

async function editUser(id) {
    try {
        const response = await fetch(`${API_BASE}/users/${id}`);
        const data = await response.json();
        showUserForm(data.user);
    } catch (error) {
        showMessage("加载用户失败: " + error.message, "error");
    }
}

async function deleteUser(id) {
    if (confirm("确定删除此用户吗？")) {
        try {
            const response = await fetch(`${API_BASE}/users/${id}`, { method: "DELETE" });
            if (response.ok) {
                showMessage("用户删除成功");
                loadUsers();
            } else {
                const error = await response.json();
                showMessage("删除失败: " + error.error, "error");
            }
        } catch (error) {
            showMessage("删除失败: " + error.message, "error");
        }
    }
}

// Package functions
async function loadPackages() {
    try {
        const response = await fetch(`${API_BASE}/packages`);
        const data = await response.json();
        displayPackages(data.packages);
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
    }
}

function displayPackages(packages) {
    const tbody = document.querySelector("#packagesTable tbody");
    tbody.innerHTML = "";
    packages.forEach(pkg => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${pkg.serial_number || ""}</td>
            <td>${pkg.pieces || ""}</td>
            <td>${pkg.length || ""}</td>
            <td>${pkg.width || ""}</td>
            <td>${pkg.height || ""}</td>
            <td>${pkg.volume || ""}</td>
            <td>${pkg.charge_weight || ""}</td>
            <td>${pkg.package_type || ""}</td>
            <td>${pkg.product_name || ""}</td>
            <td>${pkg.remark1 || ""}</td>
            <td>${pkg.remark2 || ""}</td>
            <td>
                <button onclick="editPackage('${pkg.serial_number}')">编辑</button>
            </td>
        `;
    });
}

async function editPackage(serialNumber) {
    try {
        const response = await fetch(`${API_BASE}/packages/serial/${serialNumber}`);
        const data = await response.json();
        showPackageForm(data.package);
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
    }
}

function showPackageForm(packageData = null) {
    // 创建包装信息编辑弹窗
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "packageModal";
    modal.onclick = function(event) {
        if (event.target === modal) hidePackageForm();
    };

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>修改包装信息</h3>
                <button class="modal-close" onclick="hidePackageForm()">&times;</button>
            </div>
            <form id="packageFormData">
                <div class="form-group">
                    <label>流水号:</label>
                    <input type="text" id="packageSerialNumber" required readonly>
                </div>
                <div class="form-group">
                    <label>件数:</label>
                    <input type="number" step="1" min="0" id="packagePieces">
                </div>
                <div class="form-group">
                    <label>长:</label>
                    <input type="number" step="0.01" min="0" id="packageLength">
                </div>
                <div class="form-group">
                    <label>宽:</label>
                    <input type="number" step="0.01" min="0" id="packageWidth">
                </div>
                <div class="form-group">
                    <label>高:</label>
                    <input type="number" step="0.01" min="0" id="packageHeight">
                </div>
                <div class="form-group">
                    <label>体积:</label>
                    <input type="number" step="0.0001" id="packageVolume" readonly>
                </div>
                <div class="form-group">
                    <label>包装种类:</label>
                    <input type="text" id="packageType">
                </div>
                <div class="form-group">
                    <label>计费重量:</label>
                    <input type="number" step="0.01" id="packageChargeWeight">
                </div>
                <div class="form-group">
                    <label>货物品名:</label>
                    <input type="text" id="packageProductName">
                </div>
                <div class="form-group">
                    <label>备注1:</label>
                    <textarea id="remark1"></textarea>
                </div>
                <div class="form-group">
                    <label>备注2:</label>
                    <textarea id="remark2"></textarea>
                </div>
                <div class="button-group">
                    <button type="button" onclick="savePackage()">保存</button>
                    <button type="button" onclick="hidePackageForm()">取消</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    const updatePackageVolume = () => {
        const pieces = parseFloat(document.getElementById("packagePieces").value) || 1;
        const length = parseFloat(document.getElementById("packageLength").value);
        const width = parseFloat(document.getElementById("packageWidth").value);
        const height = parseFloat(document.getElementById("packageHeight").value);

        if (isNaN(length) || isNaN(width) || isNaN(height)) {
            document.getElementById("packageVolume").value = "";
            return;
        }

        const volume = (length * width * height) / 1000000;
        document.getElementById("packageVolume").value = Number.isFinite(volume) ? volume.toFixed(4) : "";
    };

    const fillPackageFormFields = (data) => {
        if (!data) {
            return;
        }
        document.getElementById("packageProductName").value = data.product_name || "";
        document.getElementById("packagePieces").value = data.pieces || "";
        document.getElementById("packageLength").value = data.length || "";
        document.getElementById("packageWidth").value = data.width || "";
        document.getElementById("packageHeight").value = data.height || "";
        document.getElementById("packageVolume").value = data.volume || "";
        document.getElementById("packageChargeWeight").value = data.charge_weight || "";
        document.getElementById("packageType").value = data.package_type || "";
        document.getElementById("remark1").value = data.remark1 || "";
        document.getElementById("remark2").value = data.remark2 || "";
        updatePackageVolume();
    };

    const clearPackageFormFields = () => {
        document.getElementById("packageProductName").value = "";
        document.getElementById("packagePieces").value = "";
        document.getElementById("packageLength").value = "";
        document.getElementById("packageWidth").value = "";
        document.getElementById("packageHeight").value = "";
        document.getElementById("packageVolume").value = "";
        document.getElementById("packageChargeWeight").value = "";
        document.getElementById("packageType").value = "";
        document.getElementById("remark1").value = "";
        document.getElementById("remark2").value = "";
    };

    // 填充表单数据
    if (packageData) {
        document.getElementById("packageSerialNumber").value = packageData.serial_number || "";
        fillPackageFormFields(packageData);
    }

    const serialInput = document.getElementById("packageSerialNumber");
    let packageSerialTimer = null;
    let lastPackageSerial = serialInput.value.trim();

    const loadPackageBySerial = async () => {
        const serial = serialInput.value.trim();
        if (!serial) {
            clearPackageFormFields();
            return;
        }
        if (serial === lastPackageSerial) {
            return;
        }
        lastPackageSerial = serial;
        try {
            const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serial)}`);
            if (!response.ok) {
                showMessage("未找到该流水号的包装信息", "error");
                clearPackageFormFields();
                return;
            }
            const data = await response.json();
            if (data && data.package) {
                fillPackageFormFields(data.package);
            } else {
                clearPackageFormFields();
            }
        } catch (error) {
            showMessage("加载包装信息失败: " + error.message, "error");
        }
    };

    serialInput.addEventListener("change", loadPackageBySerial);
    serialInput.addEventListener("blur", loadPackageBySerial);
    serialInput.addEventListener("input", () => {
        clearTimeout(packageSerialTimer);
        packageSerialTimer = setTimeout(loadPackageBySerial, 500);
    });

    ["packagePieces", "packageLength", "packageWidth", "packageHeight"].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener("input", updatePackageVolume);
        }
    });

    modal.style.display = "block";
}

function hidePackageForm() {
    const modal = document.getElementById("packageModal");
    if (modal) {
        modal.remove();
    }
}

async function savePackage() {
    const serialNumber = document.getElementById("packageSerialNumber").value;

    if (!serialNumber) {
        showMessage("流水号不能为空", "error");
        return;
    }

    // 检查流水号是否存在
    try {
        const checkResponse = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`);
        if (checkResponse.status === 404) {
            showMessage("该流水号不存在，无法修改包装信息", "error");
            return;
        }
        if (!checkResponse.ok) {
            const error = await checkResponse.json();
            showMessage("检查流水号失败: " + (error.error || "服务器错误"), "error");
            return;
        }
    } catch (error) {
        showMessage("检查流水号失败: " + error.message, "error");
        return;
    }

    const packageData = {
        product_name: document.getElementById("packageProductName")?.value ?? null,
        pieces: document.getElementById("packagePieces")?.value ?? null,
        length: document.getElementById("packageLength")?.value ?? null,
        width: document.getElementById("packageWidth")?.value ?? null,
        height: document.getElementById("packageHeight")?.value ?? null,
        volume: document.getElementById("packageVolume")?.value ?? null,
        charge_weight: document.getElementById("packageChargeWeight")?.value ?? null,
        package_type: document.getElementById("packageType")?.value ?? null,
        remark1: document.getElementById("remark1")?.value ?? null,
        remark2: document.getElementById("remark2")?.value ?? null
    };

    try {
        const response = await fetch(`${API_BASE}/packages/serial/${serialNumber}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(packageData)
        });

        if (response.ok) {
            showMessage("包装信息保存成功");
            hidePackageForm();
            loadPackages();
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

function searchPackages() {
    currentPackageSearchTerm = document.getElementById("packageSearchInput").value.trim();
    loadAndFilterPackages();
}

async function loadAndFilterPackages() {
    try {
        const response = await fetch(`${API_BASE}/packages`);
        const data = await response.json();

        let filteredPackages = data.packages;

        // Apply search term
        if (currentPackageSearchTerm) {
            filteredPackages = filteredPackages.filter(pkg => {
                const searchLower = currentPackageSearchTerm.toLowerCase();
                return (
                    pkg.serial_number.toLowerCase().includes(searchLower) ||
                    (pkg.product_name && pkg.product_name.toLowerCase().includes(searchLower))
                );
            });
        }

        displayPackages(filteredPackages);
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
    }
}

function buildPackageFormItemHtml(item, index) {
    const order = index + 1;
    const normalizedItem = {
        ...createEmptyPackageItem(order),
        ...item,
        package_order: order,
        package_label: `包装${order}`
    };

    return `
        <div class="package-item-card" data-package-index="${order}" style="border: 1px solid #E5E7EB; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: flex-end; align-items: center; margin-bottom: 12px;">
                ${order === 1 ? "" : `<button type="button" class="remove-package-item" data-package-index="${order}">删除</button>`}
            </div>
            <div class="form-group">
                <label>件数:</label>
                <input type="number" step="1" min="0" data-field="pieces" value="${escapeHtml(normalizedItem.pieces)}">
            </div>
            <div class="form-group">
                <label>长:</label>
                <input type="number" step="0.01" min="0" data-field="length" value="${escapeHtml(normalizedItem.length)}">
            </div>
            <div class="form-group">
                <label>宽:</label>
                <input type="number" step="0.01" min="0" data-field="width" value="${escapeHtml(normalizedItem.width)}">
            </div>
            <div class="form-group">
                <label>高:</label>
                <input type="number" step="0.01" min="0" data-field="height" value="${escapeHtml(normalizedItem.height)}">
            </div>
            <div class="form-group">
                <label>体积:</label>
                <input type="number" step="0.0001" data-field="volume" value="${escapeHtml(normalizedItem.volume || calculatePackageVolume(normalizedItem))}" readonly>
            </div>
            <div class="form-group">
                <label>包装种类:</label>
                <input type="text" data-field="package_type" value="${escapeHtml(normalizedItem.package_type)}">
            </div>
            <div class="form-group">
                <label>计费重量:</label>
                <input type="number" step="0.01" data-field="charge_weight" value="${escapeHtml(normalizedItem.charge_weight)}">
            </div>
            <div class="form-group">
                <label>货物品名:</label>
                <input type="text" data-field="product_name" value="${escapeHtml(normalizedItem.product_name)}">
            </div>
            <div class="form-group">
                <label>备注1:</label>
                <textarea data-field="remark1">${escapeHtml(normalizedItem.remark1)}</textarea>
            </div>
            <div class="form-group">
                <label>备注2:</label>
                <textarea data-field="remark2">${escapeHtml(normalizedItem.remark2)}</textarea>
            </div>
        </div>
    `;
}

function serializePackageFormItems(form) {
    const chargeWeightTotal = form?.querySelector("#packageChargeWeightTotal")?.value ?? "";
    return Array.from(form.querySelectorAll(".package-item-card")).map((card, index) => {
        const order = index + 1;
        const item = createEmptyPackageItem(order);
        card.querySelectorAll("[data-field]").forEach(field => {
            item[field.dataset.field] = field.value;
        });
        item.package_order = order;
        item.package_label = `包装${order}`;
        item.volume = calculatePackageVolume(item);
        item.charge_weight = chargeWeightTotal;
        return item;
    });
}

function updatePackageCardVolume(card) {
    if (!card) {
        return;
    }

    const item = {
        pieces: card.querySelector('[data-field="pieces"]')?.value || "",
        length: card.querySelector('[data-field="length"]')?.value || "",
        width: card.querySelector('[data-field="width"]')?.value || "",
        height: card.querySelector('[data-field="height"]')?.value || ""
    };
    const volumeInput = card.querySelector('[data-field="volume"]');
    if (volumeInput) {
        volumeInput.value = calculatePackageVolume(item);
    }

    const actualWeightInput = card.querySelector('.package-item-actual-weight');
    if (actualWeightInput) {
        actualWeightInput.value = calculatePackageItemActualWeight({
            pieces: card.querySelector('[data-field="pieces"]')?.value || "",
            single_weight: card.querySelector('[data-field="single_weight"]')?.value || ""
        }) || "";
        if (actualWeightInput.value) {
            actualWeightInput.value = Number(actualWeightInput.value).toFixed(2);
        }
    }
}

function updatePackageFormTotal(form) {
    const totalInput = form.querySelector("#packageChargeWeightTotal");
    if (!totalInput) {
        return;
    }
    totalInput.value = calculatePackageChargeWeightTotal(serializePackageFormItems(form));
}

function displayPackages(packages) {
    const tbody = document.querySelector("#packagesTable tbody");
    if (!tbody) {
        return;
    }

    const groupedPackages = Array.isArray(packages?.[0]?.packages) ? packages : groupPackagesBySerial(packages);
    tbody.innerHTML = "";

    groupedPackages.forEach(group => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${group.serial_number || ""}</td>
            <td>${formatPackageItemSummary(group.packages, "pieces")}</td>
            <td>${formatPackageItemSummary(group.packages, "length")}</td>
            <td>${formatPackageItemSummary(group.packages, "width")}</td>
            <td>${formatPackageItemSummary(group.packages, "height")}</td>
            <td>${formatPackageItemSummary(group.packages, "volume")}</td>
            <td>${calculatePackageChargeWeightTotal(group.packages)}</td>
            <td>${formatPackageItemSummary(group.packages, "package_type")}</td>
            <td>${formatPackageItemSummary(group.packages, "product_name")}</td>
            <td>${formatPackageItemSummary(group.packages, "remark1")}</td>
            <td>${formatPackageItemSummary(group.packages, "remark2")}</td>
            <td>
                <button onclick="editPackage('${group.serial_number}')">编辑</button>
            </td>
        `;
    });
}

async function editPackage(serialNumber) {
    try {
        const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`);
        const data = await response.json();
        showPackageForm({
            serial_number: serialNumber,
            packages: data.packages || data.package || null
        });
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
    }
}

function showPackageForm(packageData = null) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "packageModal";
    modal.onclick = function(event) {
        if (event.target === modal) hidePackageForm();
    };

    const serialReadOnly = packageData && packageData.serial_number ? "readonly" : "";

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>修改包装信息</h3>
                <button class="modal-close" onclick="hidePackageForm()">&times;</button>
            </div>
            <form id="packageFormData">
                <div class="form-group">
                    <label>流水号:</label>
                    <input type="text" id="packageSerialNumber" required ${serialReadOnly}>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="font-weight: 600;">包装明细</div>
                    <button type="button" id="addPackageItemButton">添加</button>
                </div>
                <div id="packageItemsContainer"></div>
                <div class="button-group">
                    <button type="button" onclick="savePackage()">保存</button>
                    <button type="button" onclick="hidePackageForm()">取消</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector("#packageFormData");
    const serialInput = form.querySelector("#packageSerialNumber");
    const itemsContainer = form.querySelector("#packageItemsContainer");
    const addButton = form.querySelector("#addPackageItemButton");

    const renderPackageItems = (items) => {
        const normalizedItems = (items && items.length > 0 ? items : [createEmptyPackageItem(1)])
            .map((item, index) => ({
                ...createEmptyPackageItem(index + 1),
                ...item,
                package_order: index + 1,
                package_label: `包装${index + 1}`,
                volume: item.volume || calculatePackageVolume(item)
            }));

        itemsContainer.innerHTML = normalizedItems.map((item, index) => buildPackageFormItemHtml(item, index)).join("");
        updatePackageFormTotal(form);
    };

    const getCurrentItems = () => serializePackageFormItems(form);

    const fillPackageFormFields = (data) => {
        renderPackageItems(normalizePackageItems(data));
    };

    const clearPackageFormFields = () => {
        renderPackageItems([createEmptyPackageItem(1)]);
    };

    if (packageData) {
        serialInput.value = packageData.serial_number || "";
        fillPackageFormFields(packageData.packages || packageData);
    } else {
        clearPackageFormFields();
    }

    let packageSerialTimer = null;
    let lastPackageSerial = serialInput.value.trim();

    const loadPackageBySerial = async () => {
        const serial = serialInput.value.trim();
        if (!serial) {
            clearPackageFormFields();
            return;
        }
        if (serial === lastPackageSerial) {
            return;
        }
        lastPackageSerial = serial;
        try {
            const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serial)}`);
            if (!response.ok) {
                showMessage("未找到该流水号的包装信息", "error");
                clearPackageFormFields();
                return;
            }
            const data = await response.json();
            fillPackageFormFields(data.packages || data.package || null);
        } catch (error) {
            showMessage("加载包装信息失败: " + error.message, "error");
        }
    };

    serialInput.addEventListener("change", loadPackageBySerial);
    serialInput.addEventListener("blur", loadPackageBySerial);
    serialInput.addEventListener("input", () => {
        clearTimeout(packageSerialTimer);
        packageSerialTimer = setTimeout(loadPackageBySerial, 500);
    });

    addButton.addEventListener("click", () => {
        const items = getCurrentItems();
        items.push(createEmptyPackageItem(items.length + 1));
        renderPackageItems(items);
    });

    itemsContainer.addEventListener("click", event => {
        const removeButton = event.target.closest(".remove-package-item");
        if (!removeButton) {
            return;
        }

        const removeIndex = Number.parseInt(removeButton.dataset.packageIndex, 10);
        const nextItems = getCurrentItems().filter((_, index) => index !== removeIndex - 1);
        renderPackageItems(nextItems.length > 0 ? nextItems : [createEmptyPackageItem(1)]);
    });

    itemsContainer.addEventListener("input", event => {
        const card = event.target.closest(".package-item-card");
        if (!card) {
            return;
        }

        if (["pieces", "length", "width", "height"].includes(event.target.dataset.field)) {
            updatePackageCardVolume(card);
        }
        if (event.target.dataset.field === "charge_weight" || ["pieces", "length", "width", "height"].includes(event.target.dataset.field)) {
            updatePackageFormTotal(form);
        }
    });

    modal.style.display = "block";
}

async function savePackage() {
    const form = document.getElementById("packageFormData");
    const serialNumber = document.getElementById("packageSerialNumber").value.trim();

    if (!serialNumber) {
        showMessage("流水号不能为空", "error");
        return;
    }

    try {
        const checkResponse = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`);
        if (checkResponse.status === 404) {
            showMessage("该流水号不存在，无法修改包装信息", "error");
            return;
        }
        if (!checkResponse.ok) {
            const error = await checkResponse.json();
            showMessage("检查流水号失败: " + (error.error || "服务器错误"), "error");
            return;
        }
    } catch (error) {
        showMessage("检查流水号失败: " + error.message, "error");
        return;
    }

    let packageItems = serializePackageFormItems(form).filter(packageItemHasContent);
    if (packageItems.length === 0) {
        packageItems = [createEmptyPackageItem(1)];
    }
    packageItems = packageItems.map((item, index) => ({
        ...createEmptyPackageItem(index + 1),
        ...item,
        package_order: index + 1,
        package_label: `包装${index + 1}`,
        volume: item.volume || calculatePackageVolume(item)
    }));

    try {
        const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ package_items: packageItems })
        });

        if (response.ok) {
            showMessage("包装信息保存成功");
            hidePackageForm();
            loadPackages();
            if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
                loadOrderPackageDetails(serialNumber);
            }
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

async function loadAndFilterPackages() {
    try {
        const response = await fetch(`${API_BASE}/packages`);
        const data = await response.json();

        let filteredPackages = groupPackagesBySerial(data.packages || []);

        if (currentPackageSearchTerm) {
            const searchLower = currentPackageSearchTerm.toLowerCase();
            filteredPackages = filteredPackages.filter(pkg =>
                (pkg.serial_number && pkg.serial_number.toLowerCase().includes(searchLower)) ||
                pkg.packages.some(item =>
                    (item.product_name && item.product_name.toLowerCase().includes(searchLower)) ||
                    (item.package_type && item.package_type.toLowerCase().includes(searchLower)) ||
                    (item.package_label && item.package_label.toLowerCase().includes(searchLower))
                )
            );
        }

        displayPackages(filteredPackages);
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
    }
}

// Excel预览功能 - 预览包装信息第一行数据
async function previewPackageExcel() {
    const fileInput = document.getElementById("packageExcelFile");
    const packageImportMessage = document.getElementById("packageImportMessage");

    if (!fileInput.files || fileInput.files.length === 0) {
        showPackageImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showPackageImportMessage("正在解析Excel文件...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到后端API
        const response = await fetch(`${API_BASE}/packages/parse-excel`, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showPackageImportMessage("数据预览成功！请检查并确认信息后进行批量导入。", "success");
        } else {
            // 显示错误信息
            const errorMessage = result.details ? result.details.join("<br>") : (result.error || "预览失败");
            showPackageImportMessage(errorMessage, "error");
        }

    } catch (error) {
        showPackageImportMessage("网络错误: " + error.message, "error");
    }
}

// Excel批量导入功能 - 导入包装信息多行数据
async function importPackageExcelBatch() {
    const fileInput = document.getElementById("packageExcelFile");
    const packageImportMessage = document.getElementById("packageImportMessage");
    const packageImportResults = document.getElementById("packageImportResults");

    if (!fileInput.files || fileInput.files.length === 0) {
        showPackageImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showPackageImportMessage("正在批量导入包装信息Excel数据...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到批量导入API
        const response = await fetch(`${API_BASE}/packages/import-excel`, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            // 显示导入结果
            displayPackageImportResults(result);
            showPackageImportMessage(result.message, result.success ? "success" : "error");

            // 如果有成功导入的记录，刷新包装信息列表
            if (result.results && result.results.success > 0) {
                loadPackages();
            }
        } else {
            showPackageImportMessage(result.error || "批量导入失败", "error");
        }

    } catch (error) {
        showPackageImportMessage("网络错误: " + error.message, "error");
    }
}

// 显示包装信息导入结果
function displayPackageImportResults(result) {
    const packageImportResults = document.getElementById("packageImportResults");
    const packageImportSummary = document.getElementById("packageImportSummary");
    const packageImportErrors = document.getElementById("packageImportErrors");

    if (result.results) {
        // 显示汇总信息
        packageImportSummary.innerHTML = `
            <p><strong>总行数:</strong> ${result.results.total}</p>
            <p><strong>成功导入:</strong> ${result.results.success}</p>
            <p><strong>导入失败:</strong> ${result.results.failed}</p>
        `;

        // 显示错误详情
        if (result.results.errors && result.results.errors.length > 0) {
            let errorHtml = "<h6>错误详情:</h6><ul>";
            result.results.errors.forEach(error => {
                errorHtml += `<li><strong>第${error.row}行:</strong> ${error.errors.join(", ")}</li>`;
            });
            errorHtml += "</ul>";
            packageImportErrors.innerHTML = errorHtml;
        } else {
            packageImportErrors.innerHTML = "";
        }

        packageImportResults.style.display = "block";
    } else {
        packageImportResults.style.display = "none";
    }
}

function showPackageImportMessage(message, type = "info") {
    const packageImportMessage = document.getElementById("packageImportMessage");
    packageImportMessage.innerHTML = message;
    packageImportMessage.className = type;
}

function formatPackageDimension(value) {
    return value === undefined || value === null || String(value).trim() === "" ? "" : escapeHtml(value);
}

function formatPackageSummary(items, field, formatter = value => escapeHtml(value)) {
    return (items || [])
        .filter(packageItemHasContent)
        .map(item => item[field])
        .filter(value => value !== undefined && value !== null && String(value).trim() !== "")
        .map(value => formatter(value))
        .join("<br>");
}

function getBoxTypeById(boxTypeId) {
    return packageBoxTypes.find(item => item.box_type_id === boxTypeId) || null;
}

function ensurePackagingPageStructure() {
    const packagingPage = document.getElementById("packagingPage");
    if (!packagingPage) {
        return;
    }

    const section = packagingPage.querySelector(".section");
    if (!section) {
        return;
    }

    const existingTable = document.getElementById("packagesTable");
    const existingDbTable = document.getElementById("packagingDbTable");
    const packageTemplateButton = packagingPage.querySelector('button[onclick="downloadPackageImportTemplate()"]');
    if (existingTable && existingDbTable && packageTemplateButton) {
        return;
    }

    section.innerHTML = `
        <h2>包装信息维护</h2>
        <div class="import-section" style="margin-bottom: 24px;">
            <h4>批量导入 Excel</h4>
            <input type="file" id="packageExcelFile" accept=".xlsx,.xls">
            <button type="button" onclick="previewPackageExcel()">预览数据</button>
            <button type="button" onclick="importPackageExcelBatch()" style="margin-left: 8px;">批量导入</button>
            <button type="button" onclick="downloadPackageImportTemplate()" style="margin-left: 8px;">下载导入模板</button>
            <div id="packageImportMessage"></div>
            <div id="packageImportResults" style="display: none; margin-top: 12px;">
                <h5>导入结果</h5>
                <div id="packageImportSummary"></div>
                <div id="packageImportErrors"></div>
            </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
            <button type="button" onclick="loadPackages()">加载包装信息</button>
            <button type="button" onclick="showPackageForm()">修改包装信息</button>
            <div style="display: flex; align-items: center; gap: 8px;">
                <input type="text" id="packageSearchInput" placeholder="搜索流水号、箱型ID、品名..." style="padding: 8px 12px; border: 1px solid #D1D5DB; border-radius: 6px; font-size: 14px; width: 260px;">
                <button type="button" onclick="searchPackages()">搜索</button>
            </div>
        </div>
        <table id="packagesTable">
            <thead>
                <tr>
                    <th>流水号</th>
                    <th>公司名称</th>
                    <th>指令人</th>
                    <th>业务类型</th>
                    <th>发件人ID</th>
                    <th>客户ID</th>
                    <th>接收指令日期</th>
                    <th>起始地</th>
                    <th>目的地</th>
                    <th>贸易术语</th>
                    <th>货物品名</th>
                    <th>运输方式</th>
                    <th>运单号</th>
                    <th>件数</th>
                    <th>重量</th>
                    <th>体积</th>
                    <th>计费重量</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody></tbody>
        </table>
    `;

    const packagingDbPage = document.getElementById("packagingDBPage");
    const packagingDbSection = packagingDbPage?.querySelector(".section");
    if (packagingDbSection) {
        packagingDbSection.innerHTML = `
            <h2>包装信息库</h2>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
                <button type="button" onclick="loadPackagingDb()">加载箱型</button>
                <button type="button" onclick="showPackagingDbForm()">新增箱型</button>
                <div id="packagingDbMessage" class="info"></div>
            </div>
            <div id="packagingDbForm" style="display:none; margin-top: 16px; padding: 16px; background-color: #F9FAFB; border-radius: 6px; border: 1px solid #E5E7EB;">
                <h3 id="packagingDbFormTitle" style="margin: 0 0 16px 0; color: #111827; font-size: 16px; font-weight: 600;">箱型表单</h3>
                <form id="packagingDbFormData">
                    <div class="form-group">
                        <label>箱型ID:</label>
                        <input type="text" id="packagingDbBoxTypeId" required>
                    </div>
                    <div class="form-group">
                        <label>包装类型:</label>
                        <input type="text" id="packagingDbPackageType">
                    </div>
                    <div class="form-group">
                        <label>长(cm):</label>
                        <input type="number" step="0.01" min="0" id="packagingDbLengthCm" oninput="updatePackagingDbVolume()">
                    </div>
                    <div class="form-group">
                        <label>宽(cm):</label>
                        <input type="number" step="0.01" min="0" id="packagingDbWidthCm" oninput="updatePackagingDbVolume()">
                    </div>
                    <div class="form-group">
                        <label>高(cm):</label>
                        <input type="number" step="0.01" min="0" id="packagingDbHeightCm" oninput="updatePackagingDbVolume()">
                    </div>
                    <div class="form-group">
                        <label>体积(m³):</label>
                        <input type="number" step="0.0001" min="0" id="packagingDbVolumeCm3" readonly>
                    </div>
                    <div class="button-group" style="text-align: left; margin-top: 16px;">
                        <button type="button" onclick="savePackagingBoxType()">保存</button>
                        <button type="button" onclick="hidePackagingDbForm()">取消</button>
                    </div>
                </form>
            </div>
            <table id="packagingDbTable">
                <thead>
                    <tr>
                        <th>箱型ID</th>
                        <th>包装类型</th>
                        <th>长(cm)</th>
                        <th>宽(cm)</th>
                        <th>高(cm)</th>
                        <th>体积(m³)</th>
                        <th>更新时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `;
    }

    const packageSearchInput = document.getElementById("packageSearchInput");
    if (packageSearchInput) {
        packageSearchInput.value = currentPackageSearchTerm;
        packageSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchPackages();
            }
        });
    }
}

async function loadPackageBoxTypes(forceReload = false) {
    if (packageBoxTypesLoaded && !forceReload) {
        return packageBoxTypes;
    }

    const response = await fetch(`${API_BASE}/packages/box-types`);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || "加载箱型失败");
    }

    packageBoxTypes = Array.isArray(data.boxTypes) ? data.boxTypes : [];
    packageBoxTypesLoaded = true;
    return packageBoxTypes;
}

async function ensurePackageBoxTypesLoaded(forceReload = false) {
    try {
        return await loadPackageBoxTypes(forceReload);
    } catch (error) {
        showMessage(error.message, "error");
        return packageBoxTypes;
    }
}

function buildPackageBoxTypeOptions(selectedValue = "") {
    const normalizedSelectedValue = normalizePackageBoxTypeValue(selectedValue);
    const options = [`<option value="" ${normalizedSelectedValue ? "" : "selected"}>手动填写</option>`];
    getSelectablePackageBoxTypes().forEach(boxType => {
        const selected = boxType.box_type_id === normalizedSelectedValue ? "selected" : "";
        const label = `${escapeHtml(boxType.box_type_id)}${boxType.package_type ? ` / ${escapeHtml(boxType.package_type)}` : ""}`;
        options.push(`<option value="${escapeHtml(boxType.box_type_id)}" ${selected}>${label}</option>`);
    });
    return options.join("");
}

function normalizePackageSnapshotMetric(value) {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? null : Number(parsed.toFixed(4));
}

function normalizePackageBoxTypeValue(value) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized === LEGACY_DEFAULT_PACKAGE_BOX_TYPE_ID) {
        return "";
    }
    return normalized;
}

function getSelectablePackageBoxTypes() {
    return packageBoxTypes.filter(boxType => normalizePackageBoxTypeValue(boxType?.box_type_id));
}

function getPackageSnapshotFromValues(values = {}) {
    return {
        package_type: String(values.package_type || "").trim(),
        length: normalizePackageSnapshotMetric(values.length),
        width: normalizePackageSnapshotMetric(values.width),
        height: normalizePackageSnapshotMetric(values.height)
    };
}

function isPackageSnapshotMatch(snapshot, boxType) {
    if (!snapshot.package_type || !boxType) {
        return false;
    }

    return (
        snapshot.package_type === String(boxType.package_type || "").trim() &&
        snapshot.length === normalizePackageSnapshotMetric(boxType.length_cm) &&
        snapshot.width === normalizePackageSnapshotMetric(boxType.width_cm) &&
        snapshot.height === normalizePackageSnapshotMetric(boxType.height_cm)
    );
}

function findMatchingPackageBoxType(snapshot) {
    const matches = getSelectablePackageBoxTypes().filter(boxType => isPackageSnapshotMatch(snapshot, boxType));
    return matches.length === 1 ? matches[0] : null;
}

function readPackageCardSnapshot(card) {
    return getPackageSnapshotFromValues({
        package_type: card?.querySelector('[data-field="package_type"]')?.value,
        length: card?.querySelector('[data-field="length"]')?.value,
        width: card?.querySelector('[data-field="width"]')?.value,
        height: card?.querySelector('[data-field="height"]')?.value
    });
}

function clearPackageBoxTypeSnapshot(card) {
    if (!card) {
        return;
    }

    PACKAGE_BOX_TYPE_SNAPSHOT_FIELDS.forEach(field => {
        const input = card.querySelector(`[data-field="${field}"]`);
        if (input) {
            input.value = "";
        }
    });
}

function syncPackageBoxTypeSelection(card) {
    const select = card?.querySelector(".package-box-type-select");
    if (!select) {
        return null;
    }

    const matchedBoxType = findMatchingPackageBoxType(readPackageCardSnapshot(card));
    select.value = matchedBoxType ? matchedBoxType.box_type_id : "";
    return matchedBoxType;
}

function renderPackageBoxTypeControl(item) {
    const boxTypeId = normalizePackageBoxTypeValue(item?.box_type_id || "");
    const mode = "select";
    const selectStyle = mode === "manual" ? 'style="display:none;"' : "";
    const inputStyle = mode === "select" ? 'style="display:none;"' : "";
    const switchMode = mode === "manual" ? "select" : "manual";
    const switchLabel = mode === "manual" ? "使用下拉" : "手动填写";

    return `
        <div class="package-box-type-mode" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <select class="package-box-type-select">${buildPackageBoxTypeOptions(boxTypeId)}</select>
        </div>
    `;
}

function getPackageBoxTypeModeValue(card) {
    return card?.querySelector(".package-box-type-mode")?.dataset.boxTypeMode || "select";
}

function getPackageBoxTypeValue(card) {
    return normalizePackageBoxTypeValue(card?.querySelector(".package-box-type-select")?.value || "");
}

function setPackageBoxTypeMode(card, mode) {
    if (!card) {
        return;
    }

    const container = card.querySelector(".package-box-type-mode");
    const select = card.querySelector(".package-box-type-select");
    const input = card.querySelector(".package-box-type-input");
    const button = card.querySelector(".package-box-type-switch");
    if (!container || !select || !input || !button) {
        return;
    }

    if (mode === "manual") {
        input.value = input.value || select.value || "";
        select.style.display = "none";
        input.style.display = "";
        button.dataset.mode = "select";
        button.textContent = "使用下拉";
    } else {
        const manualValue = input.value || "";
        if ([...select.options].some(option => option.value === manualValue)) {
            select.value = manualValue;
        }
        select.style.display = "";
        input.style.display = "none";
        button.dataset.mode = "manual";
        button.textContent = "手动填写";
    }

    container.dataset.boxTypeMode = mode;
}

function applyBoxTypeSnapshot(card, boxTypeId, { clearOnManual = false } = {}) {
    if (!card) {
        return;
    }

    const normalizedBoxTypeId = normalizePackageBoxTypeValue(boxTypeId);
    const select = card.querySelector(".package-box-type-select");
    if (select) {
        select.value = normalizedBoxTypeId || "";
    }
    if (!normalizedBoxTypeId) {
        if (clearOnManual) {
            clearPackageBoxTypeSnapshot(card);
            updatePackageCardVolume(card);
        }
        return;
    }

    const boxType = getBoxTypeById(normalizedBoxTypeId);
    if (!boxType) {
        syncPackageBoxTypeSelection(card);
        return;
    }

    const mapping = {
        package_type: boxType.package_type,
        length: boxType.length_cm,
        width: boxType.width_cm,
        height: boxType.height_cm,
        volume: boxType.volume_cm3
    };

    Object.entries(mapping).forEach(([field, value]) => {
        const input = card.querySelector(`[data-field="${field}"]`);
        if (input) {
            input.value = value ?? "";
        }
    });

    updatePackageCardVolume(card);
    syncPackageBoxTypeSelection(card);
}

function togglePackageItemDetails(card) {
    if (!card) {
        return;
    }

    const details = card.querySelector(".package-item-details");
    const toggleButton = card.querySelector(".toggle-package-details");
    if (!details || !toggleButton) {
        return;
    }

    const isHidden = details.style.display === "none";
    details.style.display = isHidden ? "block" : "none";
    toggleButton.textContent = isHidden ? "收起设置" : "设置";
}

function buildPackageFormItemHtml(item, index) {
    const order = index + 1;
    const normalizedItem = {
        ...createEmptyPackageItem(order),
        ...item,
        package_order: order,
        package_label: item.package_label || `包装${order}`
    };

    return `
        <div class="package-item-card" data-package-index="${order}" style="border: 1px solid #E5E7EB; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #FFFFFF;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
                <div style="font-weight: 600; color: #111827;">${escapeHtml(normalizedItem.package_label)}</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button type="button" class="toggle-package-details">设置</button>
                    ${order === 1 ? "" : `<button type="button" class="remove-package-item" data-package-index="${order}">删除</button>`}
                </div>
            </div>
            <div class="form-group package-box-type-control">
                <label>箱型ID:</label>
                ${renderPackageBoxTypeControl(normalizedItem)}
            </div>
            <div class="form-group">
                <label>件数:</label>
                <input type="number" step="1" min="0" data-field="pieces" value="${escapeHtml(normalizedItem.pieces)}">
            </div>
            <div class="form-group">
                <label>单件重量:</label>
                <input type="number" step="0.01" min="0" data-field="single_weight" value="${escapeHtml(normalizedItem.single_weight)}">
            </div>
            <div class="package-item-details" style="display: none;">
                <div class="form-group">
                    <label>长(cm):</label>
                    <input type="number" step="0.01" min="0" data-field="length" value="${escapeHtml(normalizedItem.length)}">
                </div>
                <div class="form-group">
                    <label>宽(cm):</label>
                    <input type="number" step="0.01" min="0" data-field="width" value="${escapeHtml(normalizedItem.width)}">
                </div>
                <div class="form-group">
                    <label>高(cm):</label>
                    <input type="number" step="0.01" min="0" data-field="height" value="${escapeHtml(normalizedItem.height)}">
                </div>
                <div class="form-group">
                    <label>体积(m³):</label>
                    <input type="number" step="0.0001" data-field="volume" value="${escapeHtml(normalizedItem.volume || calculatePackageVolume(normalizedItem))}" readonly>
                </div>
                <div class="form-group">
                    <label>实重:</label>
                    <input type="number" step="0.01" class="package-item-actual-weight" value="${escapeHtml(calculatePackageItemActualWeight(normalizedItem) ? calculatePackageItemActualWeight(normalizedItem).toFixed(2) : "")}" readonly>
                </div>
                <div class="form-group">
                    <label>包装类型:</label>
                    <input type="text" data-field="package_type" value="${escapeHtml(normalizedItem.package_type)}">
                </div>
                <div class="form-group">
                    <label>品名:</label>
                    <input type="text" data-field="product_name" value="${escapeHtml(normalizedItem.product_name)}">
                </div>
                <div class="form-group">
                    <label>商品编号:</label>
                    <input type="text" data-field="product_code" value="${escapeHtml(normalizedItem.product_code)}">
                </div>
                <div class="form-group">
                    <label>报关口岸:</label>
                    <input type="text" data-field="customs_port" value="${escapeHtml(normalizedItem.customs_port)}">
                </div>
                <div class="form-group">
                    <label>报关抬头:</label>
                    <input type="text" data-field="customs_title" value="${escapeHtml(normalizedItem.customs_title)}">
                </div>
                <div class="form-group">
                    <label>监管条件:</label>
                    <input type="text" data-field="regulatory_conditions" value="${escapeHtml(normalizedItem.regulatory_conditions)}">
                </div>
                <div class="form-group">
                    <label>备注1:</label>
                    <textarea data-field="remark1">${escapeHtml(normalizedItem.remark1)}</textarea>
                </div>
                <div class="form-group">
                    <label>备注2:</label>
                    <textarea data-field="remark2">${escapeHtml(normalizedItem.remark2)}</textarea>
                </div>
            </div>
        </div>
    `;
}

function serializePackageFormItems(form) {
    return Array.from(form.querySelectorAll(".package-item-card")).map((card, index) => {
        const order = index + 1;
        const item = createEmptyPackageItem(order);
        card.querySelectorAll("[data-field]").forEach(field => {
            item[field.dataset.field] = field.value;
        });
        item.box_type_id = getPackageBoxTypeValue(card).trim();
        item.package_order = order;
        item.package_label = `包装${order}`;
        item.volume = item.volume || calculatePackageVolume(item);
        return item;
    });
}

function updatePackageCardVolume(card) {
    if (!card) {
        return;
    }

    const item = {
        pieces: card.querySelector('[data-field="pieces"]')?.value || "",
        length: card.querySelector('[data-field="length"]')?.value || "",
        width: card.querySelector('[data-field="width"]')?.value || "",
        height: card.querySelector('[data-field="height"]')?.value || ""
    };

    const volumeInput = card.querySelector('[data-field="volume"]');
    if (volumeInput) {
        volumeInput.value = calculatePackageVolume(item);
    }
}

function displayPackages(packages) {
    ensurePackagingPageStructure();
    const tbody = document.querySelector("#packagesTable tbody");
    if (!tbody) {
        return;
    }

    const groupedPackages = Array.isArray(packages?.[0]?.packages) ? packages : groupPackagesBySerial(packages || []);
    tbody.innerHTML = "";

    groupedPackages.forEach(group => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${escapeHtml(group.serial_number || "")}</td>
            <td>${escapeHtml(group.company_name || "")}</td>
            <td>${escapeHtml(group.orderer || "")}</td>
            <td>${escapeHtml(group.business_type || "")}</td>
            <td>${escapeHtml(group.sender_id || "")}</td>
            <td>${escapeHtml(group.customer_id || "")}</td>
            <td>${escapeHtml(formatDateOnly(group.receive_date))}</td>
            <td>${escapeHtml(getOrderDisplayOrigin(group))}</td>
            <td>${escapeHtml(getOrderDisplayDestination(group))}</td>
            <td>${escapeHtml(group.trade_term || "")}</td>
            <td>${escapeHtml(getOrderDisplayProductName(group))}</td>
            <td>${escapeHtml(group.transport_mode || "")}</td>
            <td>${escapeHtml(group.tracking_number || "")}</td>
            <td>${escapeHtml(calculatePackagePiecesTotal(group.packages) || "")}</td>
            <td>${escapeHtml(calculatePackageActualWeightTotal(group.packages) || "")}</td>
            <td>${escapeHtml(calculatePackageVolumeTotal(group.packages) || "")}</td>
            <td>${escapeHtml(getPackageChargeWeightValue(group.packages) || "")}</td>
            <td><button type="button" onclick="editPackage('${escapeHtml(group.serial_number || "")}')">编辑</button></td>
        `;
    });
}

async function loadPackages() {
    ensurePackagingPageStructure();
    await ensurePackageBoxTypesLoaded();

    try {
        const response = await fetch(`${API_BASE}/packages`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "加载包装信息失败");
        }

        let groupedPackages = groupPackagesBySerial(data.packages || []);
        if (currentPackageSearchTerm) {
            const searchLower = currentPackageSearchTerm.toLowerCase();
            groupedPackages = groupedPackages.filter(group =>
                (group.serial_number && group.serial_number.toLowerCase().includes(searchLower)) ||
                (group.company_name && group.company_name.toLowerCase().includes(searchLower)) ||
                (group.orderer && group.orderer.toLowerCase().includes(searchLower)) ||
                (group.business_type && group.business_type.toLowerCase().includes(searchLower)) ||
                (group.sender_id && group.sender_id.toLowerCase().includes(searchLower)) ||
                (group.customer_id && group.customer_id.toLowerCase().includes(searchLower)) ||
                (group.trade_term && group.trade_term.toLowerCase().includes(searchLower)) ||
                (getOrderDisplayOrigin(group) && getOrderDisplayOrigin(group).toLowerCase().includes(searchLower)) ||
                (getOrderDisplayDestination(group) && getOrderDisplayDestination(group).toLowerCase().includes(searchLower)) ||
                (getOrderDisplayProductName(group) && getOrderDisplayProductName(group).toLowerCase().includes(searchLower)) ||
                (group.transport_mode && group.transport_mode.toLowerCase().includes(searchLower)) ||
                (group.tracking_number && group.tracking_number.toLowerCase().includes(searchLower)) ||
                group.packages.some(item =>
                    (item.box_type_id && item.box_type_id.toLowerCase().includes(searchLower)) ||
                    (item.product_name && item.product_name.toLowerCase().includes(searchLower)) ||
                    (item.package_type && item.package_type.toLowerCase().includes(searchLower))
                )
            );
        }

        displayPackages(groupedPackages);
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
    }
}

async function editPackage(serialNumber) {
    await ensurePackageBoxTypesLoaded();

    try {
        const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "加载包装信息失败");
        }

        showPackageForm({
            serial_number: serialNumber,
            packages: data.packages || data.package || null
        });
    } catch (error) {
        showMessage("加载包装信息失败: " + error.message, "error");
    }
}

async function showPackageForm(packageData = null) {
    ensurePackagingPageStructure();
    await ensurePackageBoxTypesLoaded();

    const existingModal = document.getElementById("packageModal");
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "packageModal";
    modal.onclick = function(event) {
        if (event.target === modal) {
            hidePackageForm();
        }
    };

    const serialReadOnly = packageData && packageData.serial_number ? "readonly" : "";

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 920px;">
            <div class="modal-header">
                <h3>修改包装信息</h3>
                <button class="modal-close" onclick="hidePackageForm()">&times;</button>
            </div>
            <form id="packageFormData">
                <div class="form-group">
                    <label>流水号:</label>
                    <input type="text" id="packageSerialNumber" required ${serialReadOnly}>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap;">
                    <div style="font-weight: 600; color: #111827;">包装明细</div>
                    <button type="button" id="addPackageItemButton">新增包装</button>
                </div>
                <div id="packageItemsContainer"></div>
                <div class="form-group">
                    <label>实重:</label>
                    <input type="number" id="packageActualWeightTotal" readonly>
                </div>
                <div class="form-group">
                    <label>计费重量:</label>
                    <input type="number" step="0.01" min="0" id="packageChargeWeightTotal">
                </div>
                <div class="button-group">
                    <button type="button" onclick="savePackage()">保存</button>
                    <button type="button" onclick="hidePackageForm()">取消</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector("#packageFormData");
    const serialInput = form.querySelector("#packageSerialNumber");
    const itemsContainer = form.querySelector("#packageItemsContainer");
    const addButton = form.querySelector("#addPackageItemButton");
    const chargeWeightTotalInput = form.querySelector("#packageChargeWeightTotal");

    const renderPackageItems = (items) => {
        const normalizedItems = (items && items.length > 0 ? items : [createEmptyPackageItem(1)]).map((item, index) => ({
            ...createEmptyPackageItem(index + 1),
            ...item,
            package_order: index + 1,
            package_label: item.package_label || `包装${index + 1}`,
            volume: calculatePackageVolume(item)
        }));

        itemsContainer.innerHTML = normalizedItems.map((item, index) => buildPackageFormItemHtml(item, index)).join("");
        updatePackageFormTotal(form);
        if (chargeWeightTotalInput) {
            chargeWeightTotalInput.value = getPackageChargeWeightValue(normalizedItems);
        }
    };

    const getCurrentItems = () => serializePackageFormItems(form);

    const fillPackageFormFields = (data) => {
        renderPackageItems(normalizePackageItems(data));
    };

    const clearPackageFormFields = () => {
        renderPackageItems([createEmptyPackageItem(1)]);
    };

    if (packageData) {
        serialInput.value = packageData.serial_number || "";
        fillPackageFormFields(packageData.packages || packageData);
    } else {
        clearPackageFormFields();
    }

    let packageSerialTimer = null;
    let lastPackageSerial = serialInput.value.trim();

    const loadPackageBySerial = async () => {
        const serial = serialInput.value.trim();
        if (!serial) {
            clearPackageFormFields();
            return;
        }
        if (serial === lastPackageSerial) {
            return;
        }
        lastPackageSerial = serial;

        try {
            const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serial)}`);
            if (!response.ok) {
                if (response.status === 404) {
                    clearPackageFormFields();
                    return;
                }
                const error = await response.json();
                throw new Error(error.error || "加载包装信息失败");
            }

            const data = await response.json();
            fillPackageFormFields(data.packages || data.package || null);
        } catch (error) {
            showMessage("加载包装信息失败: " + error.message, "error");
        }
    };

    serialInput.addEventListener("change", loadPackageBySerial);
    serialInput.addEventListener("blur", loadPackageBySerial);
    serialInput.addEventListener("input", () => {
        clearTimeout(packageSerialTimer);
        packageSerialTimer = setTimeout(loadPackageBySerial, 500);
    });

    addButton.addEventListener("click", () => {
        const items = getCurrentItems();
        items.push(createEmptyPackageItem(items.length + 1));
        renderPackageItems(items);
    });

    itemsContainer.addEventListener("click", event => {
        const toggleButton = event.target.closest(".toggle-package-details");
        if (toggleButton) {
            togglePackageItemDetails(toggleButton.closest(".package-item-card"));
            return;
        }

        const removeButton = event.target.closest(".remove-package-item");
        if (removeButton) {
            const removeIndex = Number.parseInt(removeButton.dataset.packageIndex, 10);
            const nextItems = getCurrentItems().filter((_, index) => index !== removeIndex - 1);
            renderPackageItems(nextItems.length > 0 ? nextItems : [createEmptyPackageItem(1)]);
        }
    });

    itemsContainer.addEventListener("change", event => {
        const card = event.target.closest(".package-item-card");
        if (!card) {
            return;
        }

        if (event.target.matches(".package-box-type-select")) {
            applyBoxTypeSnapshot(card, event.target.value, { clearOnManual: true });
            updatePackageFormTotal(form);
        }
    });

    itemsContainer.addEventListener("input", event => {
        const card = event.target.closest(".package-item-card");
        if (!card) {
            return;
        }

        if (["pieces", "single_weight", "length", "width", "height"].includes(event.target.dataset.field)) {
            updatePackageCardVolume(card);
        }
        if (["package_type", "length", "width", "height"].includes(event.target.dataset.field)) {
            syncPackageBoxTypeSelection(card);
        }
        if (["pieces", "single_weight", "length", "width", "height"].includes(event.target.dataset.field)) {
            updatePackageFormTotal(form);
        }
    });

    modal.style.display = "block";
}

function hidePackageForm() {
    const modal = document.getElementById("packageModal");
    if (modal) {
        modal.remove();
    }
}

function updatePackageFormTotal(form) {
    const totalInput = form?.querySelector("#packageActualWeightTotal");
    if (!totalInput) {
        return;
    }
    totalInput.value = calculatePackageActualWeightTotal(serializePackageFormItems(form));
}

async function savePackage() {
    const form = document.getElementById("packageFormData");
    const serialNumber = document.getElementById("packageSerialNumber")?.value.trim();
    const chargeWeightTotal = document.getElementById("packageChargeWeightTotal")?.value ?? "";

    if (!serialNumber) {
        showMessage("流水号不能为空", "error");
        return;
    }

    try {
        const checkResponse = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`);
        if (checkResponse.status === 404) {
            showMessage("该流水号不存在，无法修改包装信息", "error");
            return;
        }
        if (!checkResponse.ok) {
            const error = await checkResponse.json();
            throw new Error(error.error || "检查流水号失败");
        }
    } catch (error) {
        showMessage("检查流水号失败: " + error.message, "error");
        return;
    }

    let packageItems = serializePackageFormItems(form).filter(packageItemHasContent);
    if (packageItems.length === 0) {
        packageItems = [createEmptyPackageItem(1)];
    }

    packageItems = packageItems.map((item, index) => ({
        ...createEmptyPackageItem(index + 1),
        ...item,
        package_order: index + 1,
        package_label: `包装${index + 1}`,
        volume: calculatePackageVolume(item),
        charge_weight: chargeWeightTotal
    }));

    try {
        const response = await fetch(`${API_BASE}/packages/serial/${encodeURIComponent(serialNumber)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ package_items: packageItems })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "保存失败");
        }

        showMessage("包装信息保存成功");
        hidePackageForm();
        await loadPackages();
        if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
            loadOrderPackageDetails(serialNumber);
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

function searchPackages() {
    const input = document.getElementById("packageSearchInput");
    currentPackageSearchTerm = input ? input.value.trim() : "";
    loadPackages();
}

async function previewPackageExcel() {
    ensurePackagingPageStructure();
    const fileInput = document.getElementById("packageExcelFile");
    if (!fileInput?.files?.length) {
        showPackageImportMessage("请选择要导入的 Excel 文件", "error");
        return;
    }

    const formData = new FormData();
    formData.append("excelFile", fileInput.files[0]);

    try {
        showPackageImportMessage("正在解析 Excel 文件...", "info");
        const response = await fetch(`${API_BASE}/packages/parse-excel`, {
            method: "POST",
            body: formData
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            const message = result.details ? result.details.join("<br>") : (result.error || "预览失败");
            showPackageImportMessage(message, "error");
            return;
        }

        const preview = result.data || {};
        showPackageImportMessage(
            `预览成功：流水号 ${escapeHtml(preview.serial_number || "")}，箱型ID ${escapeHtml(preview.box_type_id || "")}`,
            "success"
        );
    } catch (error) {
        showPackageImportMessage("预览失败: " + error.message, "error");
    }
}

async function importPackageExcelBatch() {
    ensurePackagingPageStructure();
    const fileInput = document.getElementById("packageExcelFile");
    if (!fileInput?.files?.length) {
        showPackageImportMessage("请选择要导入的 Excel 文件", "error");
        return;
    }

    const formData = new FormData();
    formData.append("excelFile", fileInput.files[0]);

    try {
        showPackageImportMessage("正在批量导入包装 Excel 数据...", "info");
        const response = await fetch(`${API_BASE}/packages/import-excel`, {
            method: "POST",
            body: formData
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "批量导入失败");
        }

        displayPackageImportResults(result);
        showPackageImportMessage(result.message || "导入完成", result.success ? "success" : "error");
        if (result.results?.success > 0) {
            await loadPackages();
        }
    } catch (error) {
        showPackageImportMessage("批量导入失败: " + error.message, "error");
    }
}

function displayPackageImportResults(result) {
    const container = document.getElementById("packageImportResults");
    const summary = document.getElementById("packageImportSummary");
    const errors = document.getElementById("packageImportErrors");
    if (!container || !summary || !errors) {
        return;
    }

    if (!result.results) {
        container.style.display = "none";
        return;
    }

    summary.innerHTML = `
        <p><strong>总行数:</strong> ${result.results.total}</p>
        <p><strong>成功导入:</strong> ${result.results.success}</p>
        <p><strong>导入失败:</strong> ${result.results.failed}</p>
    `;

    if (Array.isArray(result.results.errors) && result.results.errors.length > 0) {
        errors.innerHTML = `<h6>错误详情:</h6><ul>${result.results.errors.map(item => `<li><strong>第 ${escapeHtml(item.row)} 行</strong> ${escapeHtml((item.errors || []).join(", "))}</li>`).join("")}</ul>`;
    } else {
        errors.innerHTML = "";
    }

    container.style.display = "block";
}

function showPackageImportMessage(message, type = "info") {
    const packageImportMessage = document.getElementById("packageImportMessage");
    if (!packageImportMessage) {
        return;
    }

    packageImportMessage.innerHTML = message;
    packageImportMessage.className = type;
}

async function downloadPackageImportTemplate() {
    try {
        const response = await fetch(`${API_BASE}/packages/import-template`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "下载模板失败");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "package_import_template.xlsx";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showPackageImportMessage("导入模板下载成功", "success");
    } catch (error) {
        showPackageImportMessage("下载模板失败: " + error.message, "error");
    }
}

function showPackagingDbMessage(message, type = "info") {
    const messageElement = document.getElementById("packagingDbMessage");
    if (!messageElement) {
        return;
    }
    messageElement.textContent = message;
    messageElement.className = type;
}

function hidePackagingDbForm() {
    const formWrapper = document.getElementById("packagingDbForm");
    const form = document.getElementById("packagingDbFormData");
    if (formWrapper) {
        formWrapper.style.display = "none";
    }
    if (form) {
        form.reset();
        delete form.dataset.editId;
    }
    updatePackagingDbVolume();
}

function showPackagingDbForm(boxType = null) {
    ensurePackagingPageStructure();
    const formWrapper = document.getElementById("packagingDbForm");
    const form = document.getElementById("packagingDbFormData");
    const title = document.getElementById("packagingDbFormTitle");
    if (!formWrapper || !form) {
        return;
    }

    form.reset();
    delete form.dataset.editId;

    if (boxType) {
        title.textContent = "编辑箱型";
        form.dataset.editId = boxType.id;
        document.getElementById("packagingDbBoxTypeId").value = boxType.box_type_id || "";
        document.getElementById("packagingDbPackageType").value = boxType.package_type || "";
        document.getElementById("packagingDbLengthCm").value = boxType.length_cm || "";
        document.getElementById("packagingDbWidthCm").value = boxType.width_cm || "";
        document.getElementById("packagingDbHeightCm").value = boxType.height_cm || "";
        document.getElementById("packagingDbVolumeCm3").value = boxType.volume_cm3 || "";
    } else {
        title.textContent = "新增箱型";
    }

    formWrapper.style.display = "block";
    updatePackagingDbVolume();
}

function updatePackagingDbVolume() {
    const length = parseFloat(document.getElementById("packagingDbLengthCm")?.value);
    const width = parseFloat(document.getElementById("packagingDbWidthCm")?.value);
    const height = parseFloat(document.getElementById("packagingDbHeightCm")?.value);
    const volumeInput = document.getElementById("packagingDbVolumeCm3");
    if (!volumeInput) {
        return;
    }

    if ([length, width, height].some(value => Number.isNaN(value))) {
        volumeInput.value = "";
        return;
    }

    const volume = (length * width * height) / 1000000;
    volumeInput.value = Number.isFinite(volume) ? volume.toFixed(4) : "";
}

function displayPackagingDb(boxTypes) {
    const tbody = document.querySelector("#packagingDbTable tbody");
    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";
    (boxTypes || []).forEach(boxType => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${escapeHtml(boxType.box_type_id || "")}</td>
            <td>${escapeHtml(boxType.package_type || "")}</td>
            <td>${escapeHtml(boxType.length_cm || "")}</td>
            <td>${escapeHtml(boxType.width_cm || "")}</td>
            <td>${escapeHtml(boxType.height_cm || "")}</td>
            <td>${escapeHtml(boxType.volume_cm3 || "")}</td>
            <td>${formatDateOnly(boxType.updated_at)}</td>
            <td>
                <button type="button" onclick="editPackagingBoxType(${boxType.id})">编辑</button>
                <button type="button" onclick="deletePackagingBoxType(${boxType.id})">删除</button>
            </td>
        `;
    });
}

async function loadPackagingDb() {
    ensurePackagingPageStructure();
    try {
        const boxTypes = await loadPackageBoxTypes(true);
        displayPackagingDb(boxTypes);
        showPackagingDbMessage(`已加载 ${boxTypes.length} 个箱型`, "success");
    } catch (error) {
        showPackagingDbMessage(error.message, "error");
    }
}

async function savePackagingBoxType() {
    const form = document.getElementById("packagingDbFormData");
    if (!form) {
        return;
    }

    const payload = {
        box_type_id: document.getElementById("packagingDbBoxTypeId")?.value.trim(),
        package_type: document.getElementById("packagingDbPackageType")?.value.trim(),
        length_cm: document.getElementById("packagingDbLengthCm")?.value,
        width_cm: document.getElementById("packagingDbWidthCm")?.value,
        height_cm: document.getElementById("packagingDbHeightCm")?.value,
        volume_cm3: document.getElementById("packagingDbVolumeCm3")?.value
    };

    if (!payload.box_type_id) {
        showPackagingDbMessage("箱型ID不能为空", "error");
        return;
    }

    const editId = form.dataset.editId;

    try {
        const response = await fetch(editId ? `${API_BASE}/packages/box-types/${editId}` : `${API_BASE}/packages/box-types`, {
            method: editId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "保存箱型失败");
        }

        hidePackagingDbForm();
        await loadPackagingDb();
        await loadPackages();
        showPackagingDbMessage(editId ? "箱型更新成功" : "箱型创建成功", "success");
    } catch (error) {
        showPackagingDbMessage(error.message, "error");
    }
}

async function editPackagingBoxType(id) {
    try {
        const response = await fetch(`${API_BASE}/packages/box-types/${id}`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "加载箱型失败");
        }

        showPackagingDbForm(data.boxType || null);
    } catch (error) {
        showPackagingDbMessage(error.message, "error");
    }
}

async function deletePackagingBoxType(id) {
    if (!confirm("确定删除该箱型吗？")) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/packages/box-types/${id}`, {
            method: "DELETE"
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "删除箱型失败");
        }

        await loadPackagingDb();
        await loadPackages();
        showPackagingDbMessage("箱型删除成功", "success");
    } catch (error) {
        showPackagingDbMessage(error.message, "error");
    }
}

// Pickup tracking functions
async function loadPickupTrackings() {
    try {
        const response = await fetch(`${API_BASE}/pickup-trackings`);
        const data = await response.json();
        displayPickupTrackings(data.pickupTrackings || []);
    } catch (error) {
        showMessage("加载提货运输跟踪失败: " + error.message, "error");
    }
}

function displayPickupTrackings(trackings) {
    const tbody = document.querySelector("#pickupTrackingsTable tbody");
    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";
    trackings.forEach(item => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${item.serial_number || ""}</td>
            <td>${item.company_name || ""}</td>
            <td>${item.orderer || ""}</td>
            <td>${item.business_type || ""}</td>
            <td>${item.sender_id || ""}</td>
            <td>${item.customer_id || ""}</td>
            <td>${formatDateOnly(item.receive_date)}</td>
            <td>${getOrderDisplayOrigin(item)}</td>
            <td>${getOrderDisplayDestination(item)}</td>
            <td>${item.trade_term || ""}</td>
            <td>${getOrderDisplayProductName(item)}</td>
            <td>${item.transport_mode || ""}</td>
            <td>${item.tracking_number || ""}</td>
            <td>${item.customs_port || ""}</td>
            <td>${formatDateOnly(item.pickup_date)}</td>
            <td>${formatDateOnly(item.arrival_time)}</td>
            <td><button onclick="editPickupTracking('${item.serial_number || ""}')">编辑</button></td>
        `;
    });
}

async function editPickupTracking(serialNumber) {
    try {
        const response = await fetch(`${API_BASE}/pickup-trackings/serial/${encodeURIComponent(serialNumber)}`);
        const data = await response.json();
        if (!response.ok) {
            showMessage(data.error || "加载提货运输跟踪失败", "error");
            return;
        }
        showPickupTrackingForm(data.pickupTracking);
    } catch (error) {
        showMessage("加载提货运输跟踪失败: " + error.message, "error");
    }
}

function showPickupTrackingForm(trackingData = null) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "pickupTrackingModal";
    modal.onclick = function(event) {
        if (event.target === modal) hidePickupTrackingForm();
    };

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>修改提货运输跟踪</h3>
                <button class="modal-close" onclick="hidePickupTrackingForm()">&times;</button>
            </div>
            <form id="pickupTrackingFormData">
                <div class="form-group">
                    <label>流水号:</label>
                    <input type="text" id="pickupTrackingSerialNumber" required readonly>
                </div>
                <div class="form-group">
                    <label>运输方式:</label>
                    <input type="text" id="pickupTrackingTransportMode">
                </div>
                <div class="form-group">
                    <label>运单号:</label>
                    <input type="text" id="pickupTrackingNumber">
                </div>
                <div class="form-group">
                    <label>报关口岸:</label>
                    <input type="text" id="pickupTrackingCustomsPort">
                </div>
                <div class="form-group">
                    <label>提货日期:</label>
                    <div class="date-input-group">
                        <input type="text" id="pickupTrackingPickupDateYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="pickupTrackingPickupDateMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="pickupTrackingPickupDateDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="pickupTrackingPickupDate">
                        <input type="date" id="pickupTrackingPickupDatePicker" class="date-picker-trigger" aria-label="选择提货日期">
                    </div>
                </div>
                <div class="form-group">
                    <label>到货时间:</label>
                    <div class="date-input-group">
                        <input type="text" id="pickupTrackingArrivalTimeYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="pickupTrackingArrivalTimeMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="pickupTrackingArrivalTimeDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="pickupTrackingArrivalTime">
                        <input type="date" id="pickupTrackingArrivalTimePicker" class="date-picker-trigger" aria-label="选择到货时间">
                    </div>
                </div>
                <input type="hidden" id="pickupTrackingOrigin">
                <input type="hidden" id="pickupTrackingDestination">
                <input type="hidden" id="pickupTrackingCustomsTitle">
                <div class="form-group">
                    <label>运输供应商:</label>
                    <input type="text" id="pickupTrackingTransportSupplier">
                </div>
                <div class="form-group">
                    <label>合同协议号:</label>
                    <input type="text" id="pickupTrackingContractNumber">
                </div>
                <div class="form-group">
                    <label>货物流转信息:</label>
                    <textarea id="pickupTrackingCargoFlowInfo"></textarea>
                </div>
                <div class="form-group">
                    <label>增值服务备注:</label>
                    <textarea id="pickupTrackingValueAddedServices"></textarea>
                </div>
                <div class="form-group">
                    <label>备注1:</label>
                    <textarea id="pickupTrackingRemark1"></textarea>
                </div>
                <div class="form-group">
                    <label>备注2:</label>
                    <textarea id="pickupTrackingRemark2"></textarea>
                </div>
                <div class="button-group">
                    <button type="button" onclick="savePickupTracking()">保存</button>
                    <button type="button" onclick="hidePickupTrackingForm()">取消</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    const form = modal.querySelector("#pickupTrackingFormData");
    setupTransferDateInput("pickupTrackingPickupDate", form, updateTransferDateHidden);
    setupTransferDateInput("pickupTrackingArrivalTime", form, updateTransferDateHidden);

    const fillFields = (data) => {
        if (!data) {
            return;
        }
        form.querySelector("#pickupTrackingTransportMode").value = data.transport_mode || "";
        form.querySelector("#pickupTrackingOrigin").value = data.origin || "";
        form.querySelector("#pickupTrackingDestination").value = data.destination || "";
        form.querySelector("#pickupTrackingCustomsPort").value = data.customs_port || "";
        form.querySelector("#pickupTrackingCustomsTitle").value = data.customs_title || "";
        setTransferDateValue("pickupTrackingPickupDate", data.pickup_date, form);
        setTransferDateValue("pickupTrackingArrivalTime", data.arrival_time, form);
        fillSharedFormFields(form, PICKUP_TRACKING_SHARED_FORM_FIELDS, data);
    };

    const clearFields = () => {
        form.querySelector("#pickupTrackingTransportMode").value = "";
        form.querySelector("#pickupTrackingOrigin").value = "";
        form.querySelector("#pickupTrackingDestination").value = "";
        form.querySelector("#pickupTrackingCustomsPort").value = "";
        form.querySelector("#pickupTrackingCustomsTitle").value = "";
        setTransferDateValue("pickupTrackingPickupDate", "", form);
        setTransferDateValue("pickupTrackingArrivalTime", "", form);
        clearSharedFormFields(form, PICKUP_TRACKING_SHARED_FORM_FIELDS);
    };

    if (trackingData) {
        form.querySelector("#pickupTrackingSerialNumber").value = trackingData.serial_number || "";
        fillFields(trackingData);
    }

    const serialInput = form.querySelector("#pickupTrackingSerialNumber");
    let serialTimer = null;
    let lastSerial = serialInput.value.trim();

    const loadBySerial = async () => {
        const serial = serialInput.value.trim();
        if (!serial) {
            clearFields();
            return;
        }
        if (serial === lastSerial) {
            return;
        }
        lastSerial = serial;

        try {
            const response = await fetch(`${API_BASE}/pickup-trackings/serial/${encodeURIComponent(serial)}`);
            if (!response.ok) {
                showMessage("未找到该流水号的提货运输跟踪信息", "error");
                clearFields();
                return;
            }

            const data = await response.json();
            if (data && data.pickupTracking) {
                fillFields(data.pickupTracking);
            } else {
                clearFields();
            }
        } catch (error) {
            showMessage("加载提货运输跟踪信息失败: " + error.message, "error");
        }
    };

    serialInput.addEventListener("change", loadBySerial);
    serialInput.addEventListener("blur", loadBySerial);
    serialInput.addEventListener("input", () => {
        clearTimeout(serialTimer);
        serialTimer = setTimeout(loadBySerial, 500);
    });

    modal.style.display = "block";
}

function hidePickupTrackingForm() {
    const modal = document.getElementById("pickupTrackingModal");
    if (modal) {
        modal.remove();
    }
}

async function savePickupTracking() {
    const form = document.getElementById("pickupTrackingFormData");
    const serialNumber = document.getElementById("pickupTrackingSerialNumber").value;

    if (!serialNumber) {
        showMessage("流水号不能为空", "error");
        return;
    }

    try {
        const checkResponse = await fetch(`${API_BASE}/pickup-trackings/serial/${encodeURIComponent(serialNumber)}`);
        if (!checkResponse.ok) {
            showMessage("该流水号不存在，无法修改提货运输跟踪信息", "error");
            return;
        }
    } catch (error) {
        showMessage("检查流水号失败: " + error.message, "error");
        return;
    }

    if (form) {
        updateTransferDateHidden("pickupTrackingPickupDate", form);
        updateTransferDateHidden("pickupTrackingArrivalTime", form);
    }

    const sharedPayload = collectSharedFormPayload(form, PICKUP_TRACKING_SHARED_FORM_FIELDS, { trim: true });
    if (!sharedPayload.tracking_number) {
        showMessage("运单号不能为空", "error");
        return;
    }

    const payload = {
        transport_mode: document.getElementById("pickupTrackingTransportMode").value,
        origin: document.getElementById("pickupTrackingOrigin").value,
        destination: document.getElementById("pickupTrackingDestination").value,
        customs_port: document.getElementById("pickupTrackingCustomsPort").value,
        customs_title: document.getElementById("pickupTrackingCustomsTitle").value,
        pickup_date: document.getElementById("pickupTrackingPickupDate").value,
        arrival_time: document.getElementById("pickupTrackingArrivalTime").value,
        ...sharedPayload
    };

    try {
        const response = await fetch(`${API_BASE}/pickup-trackings/serial/${encodeURIComponent(serialNumber)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showMessage("提货运输跟踪保存成功");
            hidePickupTrackingForm();
            refreshTrackingLinkedViews(serialNumber);
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

function searchPickupTrackings() {
    const input = document.getElementById("pickupTrackingSearchInput");
    currentPickupTrackingSearchTerm = input ? input.value.trim() : "";
    loadAndFilterPickupTrackings();
}

async function loadAndFilterPickupTrackings() {
    try {
        const response = await fetch(`${API_BASE}/pickup-trackings`);
        const data = await response.json();

        let filtered = data.pickupTrackings || [];

        if (currentPickupTrackingSearchTerm) {
            const searchLower = currentPickupTrackingSearchTerm.toLowerCase();
            filtered = filtered.filter(item => (
                (item.serial_number && item.serial_number.toLowerCase().includes(searchLower)) ||
                (item.company_name && item.company_name.toLowerCase().includes(searchLower)) ||
                (item.orderer && item.orderer.toLowerCase().includes(searchLower)) ||
                (item.business_type && item.business_type.toLowerCase().includes(searchLower)) ||
                (item.sender_id && item.sender_id.toLowerCase().includes(searchLower)) ||
                (item.customer_id && item.customer_id.toLowerCase().includes(searchLower)) ||
                (item.trade_term && item.trade_term.toLowerCase().includes(searchLower)) ||
                (getOrderDisplayOrigin(item) && getOrderDisplayOrigin(item).toLowerCase().includes(searchLower)) ||
                (getOrderDisplayDestination(item) && getOrderDisplayDestination(item).toLowerCase().includes(searchLower)) ||
                (getOrderDisplayProductName(item) && getOrderDisplayProductName(item).toLowerCase().includes(searchLower)) ||
                (item.tracking_number && item.tracking_number.toLowerCase().includes(searchLower))
            ));
        }

        displayPickupTrackings(filtered);
    } catch (error) {
        showMessage("加载提货运输跟踪失败: " + error.message, "error");
    }
}

// Transfer functions
async function loadTransfers() {
    try {
        const response = await fetch(`${API_BASE}/transfers`);
        const data = await response.json();
        displayTransfers(data.transfers);
    } catch (error) {
        showMessage("加载送货运输跟踪失败: " + error.message, "error");
    }
}

function displayTransfers(transfers) {
    const tbody = document.querySelector("#transfersTable tbody");
    tbody.innerHTML = "";
    transfers.forEach(transfer => {
        const row = tbody.insertRow();

        // 格式化日期显示
        const formatDate = (dateStr) => {
            if (!dateStr) return "";
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString("zh-CN");
            } catch (error) {
                return dateStr;
            }
        };

        row.innerHTML = `
            <td>${transfer.serial_number}</td>
            <td>${transfer.company_name || ""}</td>
            <td>${transfer.orderer || ""}</td>
            <td>${transfer.business_type || ""}</td>
            <td>${transfer.sender_id || ""}</td>
            <td>${transfer.customer_id || ""}</td>
            <td>${formatDateOnly(transfer.receive_date)}</td>
            <td>${getOrderDisplayOrigin(transfer)}</td>
            <td>${getOrderDisplayDestination(transfer)}</td>
            <td>${transfer.trade_term || ""}</td>
            <td>${getOrderDisplayProductName(transfer)}</td>
            <td>${transfer.transport_mode || ""}</td>
            <td>${transfer.tracking_number || ""}</td>
            <td>${formatDateOnly(transfer.pickup_date)}</td>
            <td>${formatDateOnly(transfer.arrival_port_time)}</td>
            <td>${formatDateOnly(transfer.complete_docs_send_time)}</td>
            <td>
                <button onclick="editTransfer('${transfer.serial_number}')">编辑</button>
            </td>
        `;
    });
}

async function editTransfer(serialNumber) {
    try {
        const encoded = encodeURIComponent(serialNumber);
        const response = await fetch(`${API_BASE}/transfers/serial/${encoded}`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "加载送货运输跟踪失败");
        }
        showTransferForm(data.transfer);
    } catch (error) {
        showMessage("加载送货运输跟踪失败: " + error.message, "error");
    }
}

function showTransferForm(transferData = null) {
    // 创建送货运输跟踪编辑弹窗
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "transferModal";
    modal.onclick = function(event) {
        if (event.target === modal) hideTransferForm();
    };

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>修改送货运输跟踪</h3>
                <button class="modal-close" onclick="hideTransferForm()">&times;</button>
            </div>
            <form id="transferFormData">
                <div class="form-group">
                    <label>流水号:</label>
                    <input type="text" id="transferSerialNumber" required>
                </div>
                <div class="form-group">
                    <label>运输方式:</label>
                    <input type="text" id="transferTransportMode">
                </div>
                <div class="form-group">
                    <label>运单号:</label>
                    <input type="text" id="transferTrackingNumber" required>
                </div>
                <div class="form-group">
                    <label>提货日期:</label>
                    <div class="date-input-group">
                        <input type="text" id="transferPickupDateYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="transferPickupDateMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="transferPickupDateDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="transferPickupDate">
                        <input type="date" id="transferPickupDatePicker" class="date-picker-trigger" aria-label="选择提货日期">
                    </div>
                </div>
                <div class="form-group">
                    <label>到货时间:</label>
                    <div class="date-input-group">
                        <input type="text" id="transferArrivalPortTimeYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="transferArrivalPortTimeMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="transferArrivalPortTimeDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="transferArrivalPortTime">
                        <input type="date" id="transferArrivalPortTimePicker" class="date-picker-trigger" aria-label="选择到货时间">
                    </div>
                </div>
                <div class="form-group">
                    <label>完整单据回复时间:</label>
                    <div class="date-input-group">
                        <input type="text" id="transferCompleteDocsSendTimeYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="transferCompleteDocsSendTimeMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="transferCompleteDocsSendTimeDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="transferCompleteDocsSendTime">
                        <input type="date" id="transferCompleteDocsSendTimePicker" class="date-picker-trigger" aria-label="选择完整单据回复时间">
                    </div>
                </div>
                <div class="form-group">
                    <label>运输供应商:</label>
                    <input type="text" id="transferSupplier">
                </div>
                <div class="form-group">
                    <label>货物流转信息:</label>
                    <textarea id="transferCargoFlowInfo"></textarea>
                </div>
                <textarea id="transferValueAddedServices" style="display:none;"></textarea>
                <div class="form-group">
                    <label>备注1:</label>
                    <textarea id="transferRemark1"></textarea>
                </div>
                <div class="form-group">
                    <label>备注2:</label>
                    <textarea id="transferRemark2"></textarea>
                </div>
                <div class="button-group">
                    <button type="button" onclick="saveTransfer()">保存</button>
                    <button type="button" onclick="hideTransferForm()">取消</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector("#transferFormData");
    initTransferDateInputs(form);

    const fillTransferFormFields = (data) => {
        if (!data) {
            return;
        }
        form.querySelector("#transferTransportMode").value = data.transport_mode || "";
        setTransferDateValue("transferPickupDate", data.pickup_date, form);
        setTransferDateValue("transferArrivalPortTime", data.arrival_port_time, form);
        setTransferDateValue("transferCompleteDocsSendTime", data.complete_docs_send_time, form);
        fillSharedFormFields(form, TRANSFER_TRACKING_SHARED_FORM_FIELDS, data);
    };

    const clearTransferFormFields = () => {
        form.querySelector("#transferTransportMode").value = "";
        setTransferDateValue("transferPickupDate", "", form);
        setTransferDateValue("transferArrivalPortTime", "", form);
        setTransferDateValue("transferCompleteDocsSendTime", "", form);
        clearSharedFormFields(form, TRANSFER_TRACKING_SHARED_FORM_FIELDS);
    };

    // 填充表单数据
    if (transferData) {
        form.querySelector("#transferSerialNumber").value = transferData.serial_number || "";
        fillTransferFormFields(transferData);
    }

    const serialInput = form.querySelector("#transferSerialNumber");
    let transferSerialTimer = null;
    let lastTransferSerial = serialInput.value.trim();

    const loadTransferBySerial = async () => {
        const serial = serialInput.value.trim();
        if (!serial) {
            clearTransferFormFields();
            return;
        }
        if (serial === lastTransferSerial) {
            return;
        }
        lastTransferSerial = serial;
        try {
            const encoded = encodeURIComponent(serial);
            const response = await fetch(`${API_BASE}/transfers/serial/${encoded}`);
            if (!response.ok) {
                showMessage("未找到该流水号的送货运输跟踪信息", "error");
                clearTransferFormFields();
                return;
            }
            const data = await response.json();
            if (data && data.transfer) {
                fillTransferFormFields(data.transfer);
            } else {
                clearTransferFormFields();
            }
        } catch (error) {
            showMessage("加载送货运输跟踪信息失败: " + error.message, "error");
        }
    };

    serialInput.addEventListener("change", loadTransferBySerial);
    serialInput.addEventListener("blur", loadTransferBySerial);
    serialInput.addEventListener("input", () => {
        clearTimeout(transferSerialTimer);
        transferSerialTimer = setTimeout(loadTransferBySerial, 500);
    });

    modal.style.display = "block";
}

function hideTransferForm() {
    const modal = document.getElementById("transferModal");
    if (modal) {
        modal.remove();
    }
}

async function saveTransfer() {
    const form = document.getElementById("transferFormData");
    const serialNumber = document.getElementById("transferSerialNumber").value.trim();
    const sharedPayload = collectSharedFormPayload(form, TRANSFER_TRACKING_SHARED_FORM_FIELDS, { trim: true });
    const trackingNumber = sharedPayload.tracking_number || "";

    if (!serialNumber) {
        showMessage("流水号不能为空", "error");
        return;
    }

    if (!trackingNumber) {
        showMessage("运单号不能为空", "error");
        return;
    }

    // 检查流水号是否存在
    try {
        const encoded = encodeURIComponent(serialNumber);
        const checkResponse = await fetch(`${API_BASE}/transfers/serial/${encoded}`);
        if (!checkResponse.ok) {
            let errorMessage = "该流水号不存在，无法修改送货运输跟踪信息";
            try {
                const checkError = await checkResponse.json();
                errorMessage = checkError.error || errorMessage;
            } catch (parseError) {
                console.error("Failed to parse transfer precheck error:", parseError);
            }
            showMessage(errorMessage, "error");
            return;
        }
    } catch (error) {
        showMessage("检查流水号失败: " + error.message, "error");
        return;
    }

    if (form) {
        updateTransferDateHidden("transferPickupDate", form);
        updateTransferDateHidden("transferArrivalPortTime", form);
        updateTransferDateHidden("transferCompleteDocsSendTime", form);
    }

    const transferData = {
        serial_number: serialNumber,
        transport_mode: document.getElementById("transferTransportMode").value,
        pickup_date: document.getElementById("transferPickupDate").value,
        arrival_port_time: document.getElementById("transferArrivalPortTime").value,
        complete_docs_send_time: document.getElementById("transferCompleteDocsSendTime").value,
        ...sharedPayload
    };

    try {
        const encoded = encodeURIComponent(serialNumber);
        const response = await fetch(`${API_BASE}/transfers/serial/${encoded}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(transferData)
        });

        if (response.ok) {
            showMessage("送货运输跟踪保存成功");
            hideTransferForm();
            refreshTrackingLinkedViews(serialNumber);
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

function searchTransfers() {
    currentTransferSearchTerm = document.getElementById("transferSearchInput").value.trim();
    loadAndFilterTransfers();
}

async function loadAndFilterTransfers() {
    try {
        const response = await fetch(`${API_BASE}/transfers`);
        const data = await response.json();

        let filteredTransfers = data.transfers;

        // Apply search term
        if (currentTransferSearchTerm) {
            filteredTransfers = filteredTransfers.filter(transfer => {
                const searchLower = currentTransferSearchTerm.toLowerCase();
                return (
                    transfer.serial_number.toLowerCase().includes(searchLower) ||
                    (transfer.company_name && transfer.company_name.toLowerCase().includes(searchLower)) ||
                    (transfer.orderer && transfer.orderer.toLowerCase().includes(searchLower)) ||
                    (transfer.business_type && transfer.business_type.toLowerCase().includes(searchLower)) ||
                    (transfer.sender_id && transfer.sender_id.toLowerCase().includes(searchLower)) ||
                    (transfer.customer_id && transfer.customer_id.toLowerCase().includes(searchLower)) ||
                    (transfer.trade_term && transfer.trade_term.toLowerCase().includes(searchLower)) ||
                    (getOrderDisplayOrigin(transfer) && getOrderDisplayOrigin(transfer).toLowerCase().includes(searchLower)) ||
                    (getOrderDisplayDestination(transfer) && getOrderDisplayDestination(transfer).toLowerCase().includes(searchLower)) ||
                    (getOrderDisplayProductName(transfer) && getOrderDisplayProductName(transfer).toLowerCase().includes(searchLower)) ||
                    transfer.tracking_number.toLowerCase().includes(searchLower) ||
                    (transfer.transport_mode && transfer.transport_mode.toLowerCase().includes(searchLower))
                );
            });
        }

        displayTransfers(filteredTransfers);
    } catch (error) {
        showMessage("加载送货运输跟踪失败: " + error.message, "error");
    }
}

// Excel预览功能 - 预览送货运输跟踪第一行数据
async function previewTransferExcel() {
    const fileInput = document.getElementById("transferExcelFile");
    const transferImportMessage = document.getElementById("transferImportMessage");

    if (!fileInput.files || fileInput.files.length === 0) {
        showTransferImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showTransferImportMessage("正在解析送货运输跟踪Excel文件...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到后端API
        const response = await fetch(`${API_BASE}/transfers/parse-excel`, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showTransferImportMessage("数据预览成功！请检查并确认信息后进行批量导入。", "success");
        } else {
            // 显示错误信息
            const errorMessage = result.details ? result.details.join("<br>") : (result.error || "预览失败");
            showTransferImportMessage(errorMessage, "error");
        }

    } catch (error) {
        showTransferImportMessage("网络错误: " + error.message, "error");
    }
}

// Excel批量导入功能 - 导入送货运输跟踪多行数据
async function importTransferExcelBatch() {
    const fileInput = document.getElementById("transferExcelFile");
    const transferImportMessage = document.getElementById("transferImportMessage");
    const transferImportResults = document.getElementById("transferImportResults");

    if (!fileInput.files || fileInput.files.length === 0) {
        showTransferImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showTransferImportMessage("正在批量导入送货运输跟踪Excel数据...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到批量导入API
        const response = await fetch(`${API_BASE}/transfers/import-excel`, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            // 显示导入结果
            displayTransferImportResults(result);
            showTransferImportMessage(result.message, result.success ? "success" : "error");

            // 如果有成功导入的记录，刷新送货运输跟踪列表
            if (result.results && result.results.success > 0) {
                loadTransfers();
            }
        } else {
            showTransferImportMessage(result.error || "批量导入失败", "error");
        }

    } catch (error) {
        showTransferImportMessage("网络错误: " + error.message, "error");
    }
}

// 显示送货运输跟踪导入结果
function displayTransferImportResults(result) {
    const transferImportResults = document.getElementById("transferImportResults");
    const transferImportSummary = document.getElementById("transferImportSummary");
    const transferImportErrors = document.getElementById("transferImportErrors");

    if (result.results) {
        // 显示汇总信息
        transferImportSummary.innerHTML = `
            <p><strong>总行数:</strong> ${result.results.total}</p>
            <p><strong>成功导入:</strong> ${result.results.success}</p>
            <p><strong>导入失败:</strong> ${result.results.failed}</p>
        `;

        // 显示错误详情
        if (result.results.errors && result.results.errors.length > 0) {
            let errorHtml = "<h6>错误详情:</h6><ul>";
            result.results.errors.forEach(error => {
                errorHtml += `<li><strong>第${error.row}行:</strong> ${error.errors.join(", ")}</li>`;
            });
            errorHtml += "</ul>";
            transferImportErrors.innerHTML = errorHtml;
        } else {
            transferImportErrors.innerHTML = "";
        }

        transferImportResults.style.display = "block";
    } else {
        transferImportResults.style.display = "none";
    }
}

function showTransferImportMessage(message, type = "info") {
    const transferImportMessage = document.getElementById("transferImportMessage");
    transferImportMessage.innerHTML = message;
    transferImportMessage.className = type;
}

// Guest functions
async function loadGuests() {
    try {
        const response = await fetch(`${API_BASE}/guests`);
        const data = await response.json();
        displayGuests(data.guests);
    } catch (error) {
        showMessage("加载客户信息失败: " + error.message, "error");
    }
}

function displayGuests(guests) {
    const tbody = document.querySelector("#guestsTable tbody");
    tbody.innerHTML = "";
    guests.forEach(guest => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${guest.guest_id}</td>
            <td>${guest.region || ""}</td>
            <td>${guest.company_cn || ""}</td>
            <td>${guest.company_en || ""}</td>
            <td>${guest.contact_name || ""}</td>
            <td>${guest.phone || ""}</td>
            <td>${guest.email || ""}</td>
            <td>${guest.tax_no || ""}</td>
            <td>${guest.customs_10digit || ""}</td>
            <td>
                <button onclick="editGuest(${guest.guest_id})">编辑</button>
                <button onclick="deleteGuest(${guest.guest_id})">删除</button>
            </td>
        `;
    });
}

function showGuestForm(guest = null) {
    const form = document.getElementById("guestForm");
    if (guest) {
        document.getElementById("guestId").value = guest.guest_id || "";
        document.getElementById("guestRegion").value = guest.region || "";
        document.getElementById("guestCompanyCn").value = guest.company_cn || "";
        document.getElementById("guestCompanyEn").value = guest.company_en || "";
        document.getElementById("guestAddressCn").value = guest.address_cn || "";
        document.getElementById("guestAddressEn").value = guest.address_en || "";
        document.getElementById("guestPostcode").value = guest.postcode || "";
        document.getElementById("guestContactName").value = guest.contact_name || "";
        document.getElementById("guestPhone").value = guest.phone || "";
        document.getElementById("guestEmail").value = guest.email || "";
        document.getElementById("guestTaxNo").value = guest.tax_no || "";
        document.getElementById("guestCustoms10Digit").value = guest.customs_10digit || "";
        document.getElementById("guestRemark").value = guest.remark || "";
        form.dataset.editId = guest.guest_id;
    } else {
        clearForms();
        delete form.dataset.editId;
    }
    form.style.display = "block";
}

function hideGuestForm() {
    document.getElementById("guestForm").style.display = "none";
    clearForms();
}

// Product functions
async function loadProducts() {
    try {
        const response = await fetch(`${API_BASE}/products`);
        const data = await response.json();
        displayProducts(data.products || []);
    } catch (error) {
        showMessage("加载产品失败: " + error.message, "error");
    }
}

function displayProducts(products) {
    const tbody = document.querySelector("#productsTable tbody");
    tbody.innerHTML = "";
    products.forEach(p => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${p.product_id || ''}</td>
            <td>${p.name_cn || ''}</td>
            <td>${p.description_en || ''}</td>
            <td>${p.hs_code || ''}</td>
            <td>${p.origin || ''}</td>
            <td>${p.declaration_elements || ''}</td>
            <td>${p.remark || ''}</td>
            <td>
                <button onclick="editProduct(${p.id})">编辑</button>
                <button onclick="deleteProduct(${p.id})">删除</button>
            </td>
        `;
    });
}

function showProductForm(product = null) {
    const form = document.getElementById('productForm');
    if (product) {
        document.getElementById('productIdField').value = product.product_id || '';
        document.getElementById('productNameCn').value = product.name_cn || '';
        document.getElementById('productDescriptionEn').value = product.description_en || '';
        document.getElementById('productHsCode').value = product.hs_code || '';
        document.getElementById('productDeclaration').value = product.declaration_elements || '';
        document.getElementById('productOrigin').value = product.origin || '';
        document.getElementById('productRemark').value = product.remark || '';
        form.dataset.editId = product.id;
    } else {
        document.getElementById('productFormData').reset();
        document.getElementById('productIdField').value = '';
        delete form.dataset.editId;
    }
    form.style.display = 'block';
}

function hideProductForm() {
    document.getElementById('productForm').style.display = 'none';
    document.getElementById('productFormData').reset();
    delete document.getElementById('productForm').dataset.editId;
}

async function saveProduct() {
    const form = document.getElementById('productForm');
    const editId = form.dataset.editId;
    const payload = {
        name_cn: document.getElementById('productNameCn').value,
        description_en: document.getElementById('productDescriptionEn').value,
        hs_code: document.getElementById('productHsCode').value,
        declaration_elements: document.getElementById('productDeclaration').value,
        origin: document.getElementById('productOrigin').value,
        remark: document.getElementById('productRemark').value
    };

    try {
        let response;
        if (editId) {
            response = await fetch(`${API_BASE}/products/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            response = await fetch(`${API_BASE}/products`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        const data = await response.json();
        if (response.ok) {
            hideProductForm();
            loadProducts();
            showMessage('保存成功');
        } else {
            showMessage(data.error || '保存失败', 'error');
        }
    } catch (err) {
        showMessage('网络错误: ' + err.message, 'error');
    }
}

async function editProduct(id) {
    try {
        const response = await fetch(`${API_BASE}/products/${id}`);
        const data = await response.json();
        if (response.ok) {
            showProductForm(data.product);
        } else {
            showMessage(data.error || '加载失败', 'error');
        }
    } catch (err) {
        showMessage('网络错误: ' + err.message, 'error');
    }
}

async function deleteProduct(id) {
    if (!confirm('确认删除此产品？')) return;
    try {
        const response = await fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (response.ok) {
            loadProducts();
            showMessage('删除成功');
        } else {
            showMessage(data.error || '删除失败', 'error');
        }
    } catch (err) {
        showMessage('网络错误: ' + err.message, 'error');
    }
}

async function saveGuest() {
    const form = document.getElementById("guestForm");
    const guestData = {
        region: document.getElementById("guestRegion").value,
        company_cn: document.getElementById("guestCompanyCn").value,
        company_en: document.getElementById("guestCompanyEn").value,
        address_cn: document.getElementById("guestAddressCn").value,
        address_en: document.getElementById("guestAddressEn").value,
        postcode: document.getElementById("guestPostcode").value,
        contact_name: document.getElementById("guestContactName").value,
        phone: document.getElementById("guestPhone").value,
        email: document.getElementById("guestEmail").value,
        tax_no: document.getElementById("guestTaxNo").value,
        customs_10digit: document.getElementById("guestCustoms10Digit").value,
        remark: document.getElementById("guestRemark").value
    };

    // Validate required fields (guest_id now generated by DB)
    if (!guestData.contact_name || guestData.contact_name.trim() === "") {
        showMessage("联系人姓名不能为空", "error");
        return;
    }

    try {
        let response;
        if (form.dataset.editId) {
            response = await fetch(`${API_BASE}/guests/${form.dataset.editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(guestData)
            });
        } else {
            // For create, do not send guest_id (DB will generate it)
            response = await fetch(`${API_BASE}/guests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(guestData)
            });
        }

        if (response.ok) {
            showMessage("客户信息保存成功");
            hideGuestForm();
            loadGuests();
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

async function editGuest(id) {
    try {
        const response = await fetch(`${API_BASE}/guests/${id}`);
        const data = await response.json();
        showGuestForm(data.guest);
    } catch (error) {
        showMessage("加载客户信息失败: " + error.message, "error");
    }
}

async function deleteGuest(id) {
    if (confirm("确定删除此客户吗？")) {
        try {
            const response = await fetch(`${API_BASE}/guests/${id}`, { method: "DELETE" });
            if (response.ok) {
                showMessage("客户删除成功");
                loadGuests();
            } else {
                const error = await response.json();
                showMessage("删除失败: " + error.error, "error");
            }
        } catch (error) {
            showMessage("删除失败: " + error.message, "error");
        }
    }
}

function searchGuests() {
    currentGuestSearchTerm = document.getElementById("guestSearchInput").value.trim();
    loadAndFilterGuests();
}

async function loadAndFilterGuests() {
    try {
        const response = await fetch(`${API_BASE}/guests`);
        const data = await response.json();

        let filteredGuests = data.guests;

        // Apply search term
        if (currentGuestSearchTerm) {
            filteredGuests = filteredGuests.filter(guest => {
                const searchLower = currentGuestSearchTerm.toLowerCase();
                return (
                    (guest.contact_name && guest.contact_name.toLowerCase().includes(searchLower)) ||
                    (guest.company_cn && guest.company_cn.toLowerCase().includes(searchLower)) ||
                    (guest.company_en && guest.company_en.toLowerCase().includes(searchLower)) ||
                    (guest.phone && guest.phone.toLowerCase().includes(searchLower)) ||
                    (guest.email && guest.email.toLowerCase().includes(searchLower)) ||
                    (guest.region && guest.region.toLowerCase().includes(searchLower))
                );
            });
        }

        displayGuests(filteredGuests);
    } catch (error) {
        showMessage("加载客户信息失败: " + error.message, "error");
    }
}

// Excel预览功能 - 预览客户信息第一行数据
async function previewGuestExcel() {
    const fileInput = document.getElementById("guestExcelFile");
    const guestImportMessage = document.getElementById("guestImportMessage");

    if (!fileInput.files || fileInput.files.length === 0) {
        showGuestImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showGuestImportMessage("正在解析Excel文件...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到后端API
        const response = await fetch(`${API_BASE}/guests/parse-excel`, {
            method: "POST",
            body: formData
        });

        // 改进的错误处理
        let result;
        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("application/json")) {
            try {
                result = await response.json();
            } catch (jsonError) {
                console.error("JSON解析错误:", jsonError);
                showGuestImportMessage("服务器响应格式错误，请检查服务器状态", "error");
                return;
            }
        } else {
            // 如果不是JSON响应，可能是HTML错误页面
            const textResponse = await response.text();
            console.error("非JSON响应:", textResponse);
            showGuestImportMessage("服务器响应格式错误，请检查服务器状态", "error");
            return;
        }

        if (response.ok && result.success) {
            // 自动填充表单
            fillGuestFormWithData(result.data);
            showGuestImportMessage("数据预览成功！请检查并确认信息后保存或进行批量导入。", "success");
        } else {
            // 显示错误信息
            const errorMessage = result.details ? result.details.join("<br>") : (result.error || "预览失败");
            showGuestImportMessage(errorMessage, "error");
        }

    } catch (error) {
        console.error("网络请求错误:", error);
        showGuestImportMessage("网络错误: " + error.message, "error");
    }
}

// Excel批量导入功能 - 导入客户信息多行数据
async function importGuestExcelBatch() {
    const fileInput = document.getElementById("guestExcelFile");
    const guestImportMessage = document.getElementById("guestImportMessage");
    const guestImportResults = document.getElementById("guestImportResults");

    if (!fileInput.files || fileInput.files.length === 0) {
        showGuestImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    const file = fileInput.files[0];

    try {
        showGuestImportMessage("正在批量导入客户信息Excel数据...", "info");

        // 创建FormData来发送文件
        const formData = new FormData();
        formData.append("excelFile", file);

        // 发送到批量导入API
        const response = await fetch(`${API_BASE}/guests/import-excel`, {
            method: "POST",
            body: formData
        });

        // 改进的错误处理
        let result;
        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("application/json")) {
            try {
                result = await response.json();
            } catch (jsonError) {
                console.error("JSON解析错误:", jsonError);
                showGuestImportMessage("服务器响应格式错误，请检查服务器状态", "error");
                return;
            }
        } else {
            // 如果不是JSON响应，可能是HTML错误页面
            const textResponse = await response.text();
            console.error("非JSON响应:", textResponse);
            showGuestImportMessage("服务器响应格式错误，请检查服务器状态", "error");
            return;
        }

        if (response.ok) {
            // 显示导入结果
            displayGuestImportResults(result);
            showGuestImportMessage(result.message, result.success ? "success" : "error");

            // 如果有成功导入的记录，刷新客户信息列表
            if (result.results && result.results.success > 0) {
                loadGuests();
            }
        } else {
            showGuestImportMessage(result.error || "批量导入失败", "error");
        }

    } catch (error) {
        console.error("网络请求错误:", error);
        showGuestImportMessage("网络错误: " + error.message, "error");
    }
}

// 显示客户信息导入结果
function displayGuestImportResults(result) {
    const guestImportResults = document.getElementById("guestImportResults");
    const guestImportSummary = document.getElementById("guestImportSummary");
    const guestImportErrors = document.getElementById("guestImportErrors");

    if (result.results) {
        // 显示汇总信息
        guestImportSummary.innerHTML = `
            <p><strong>总行数:</strong> ${result.results.total}</p>
            <p><strong>成功导入:</strong> ${result.results.success}</p>
            <p><strong>导入失败:</strong> ${result.results.failed}</p>
        `;

        // 显示错误详情
        if (result.results.errors && result.results.errors.length > 0) {
            let errorHtml = "<h6>错误详情:</h6><ul>";
            result.results.errors.forEach(error => {
                errorHtml += `<li><strong>第${error.row}行:</strong> ${error.errors.join(", ")}</li>`;
            });
            errorHtml += "</ul>";
            guestImportErrors.innerHTML = errorHtml;
        } else {
            guestImportErrors.innerHTML = "";
        }

        guestImportResults.style.display = "block";
    } else {
        guestImportResults.style.display = "none";
    }
}

function fillGuestFormWithData(data) {
    // 填充客户表单字段 (匹配实际数据库字段)
    const fieldMapping = {
        guest_id: 'guestId',
        region: 'guestRegion',
        company_cn: 'guestCompanyCn',
        company_en: 'guestCompanyEn',
        address_cn: 'guestAddressCn',
        address_en: 'guestAddressEn',
        postcode: 'guestPostcode',
        contact_name: 'guestContactName',
        phone: 'guestPhone',
        email: 'guestEmail',
        tax_no: 'guestTaxNo',
        customs_10digit: 'guestCustoms10Digit',
        remark: 'guestRemark'
    };

    for (const [dbField, formField] of Object.entries(fieldMapping)) {
        if (data[dbField] !== undefined) {
            const element = document.getElementById(formField);
            if (element) {
                element.value = data[dbField];
            }
        }
    }
}

function showGuestImportMessage(message, type = "info") {
    const guestImportMessage = document.getElementById("guestImportMessage");
    guestImportMessage.innerHTML = message;
    guestImportMessage.className = type;
}

function displayLibraryImportResults(result, resultContainerId, summaryId, errorsId) {
    const resultContainer = document.getElementById(resultContainerId);
    const summary = document.getElementById(summaryId);
    const errors = document.getElementById(errorsId);

    if (!resultContainer || !summary || !errors) {
        return;
    }

    if (result.results) {
        const createdCount = Number(result.results.success || 0);
        const updatedCount = Number(result.results.updated || 0);
        const mergedCount = Number(result.results.merged || 0);
        const failedCount = Number(result.results.failed || 0);
        const hasExtendedCounters = updatedCount > 0 || mergedCount > 0;

        summary.innerHTML = `
            <p><strong>总行数:</strong> ${result.results.total}</p>
            <p><strong>${hasExtendedCounters ? "新增创建" : "成功导入"}:</strong> ${createdCount}</p>
            ${hasExtendedCounters ? `<p><strong>更新已有:</strong> ${updatedCount}</p>` : ""}
            ${hasExtendedCounters ? `<p><strong>合并已有:</strong> ${mergedCount}</p>` : ""}
            <p><strong>导入失败:</strong> ${failedCount}</p>
        `;

        if (result.results.errors && result.results.errors.length > 0) {
            let errorHtml = "<h6>错误详情:</h6><ul>";
            result.results.errors.forEach(error => {
                errorHtml += `<li><strong>第${error.row}行:</strong> ${error.errors.join(", ")}</li>`;
            });
            errorHtml += "</ul>";
            errors.innerHTML = errorHtml;
        } else {
            errors.innerHTML = "";
        }

        resultContainer.style.display = "block";
    } else {
        resultContainer.style.display = "none";
    }
}

function showSenderImportMessage(message, type = "info") {
    const messageEl = document.getElementById("senderImportMessage");
    if (messageEl) {
        messageEl.innerHTML = message;
        messageEl.className = type;
    }
}

function showCustomerImportMessage(message, type = "info") {
    const messageEl = document.getElementById("customerImportMessage");
    if (messageEl) {
        messageEl.innerHTML = message;
        messageEl.className = type;
    }
}

async function loadSenders() {
    try {
        const response = await fetch(`${API_BASE}/senders`);
        const data = await response.json();
        displaySenders(data.senders || []);
    } catch (error) {
        showMessage("加载发件人信息失败: " + error.message, "error");
    }
}

function displaySenders(senders) {
    sendersData = senders; // 保存发件人数据到全局变量
    const tbody = document.querySelector("#sendersTable tbody");
    if (!tbody) {
        return;
    }
    tbody.innerHTML = "";
    senders.forEach(sender => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${sender.sender_id || ""}</td>
            <td>${sender.shipping_address || ""}</td>
            <td>${sender.sender_name || ""}</td>
            <td>${sender.sender_phone || ""}</td>
            <td>
                <button onclick="editSender('${sender.sender_id}')">编辑</button>
                <button onclick="deleteSender('${sender.sender_id}')">删除</button>
            </td>
        `;
    });
}

function showSenderForm(sender = null) {
    const form = document.getElementById("senderForm");
    if (!form) {
        return;
    }
    const idEl = document.getElementById("senderInfoId");
    const addressEl = document.getElementById("senderInfoAddress");
    const nameEl = document.getElementById("senderInfoName");
    const phoneEl = document.getElementById("senderInfoPhone");

    if (sender) {
        idEl.value = sender.sender_id || "";
        addressEl.value = sender.shipping_address || "";
        nameEl.value = sender.sender_name || "";
        phoneEl.value = sender.sender_phone || "";
        idEl.readOnly = true;
        form.dataset.editId = sender.sender_id;
    } else {
        document.getElementById("senderFormData").reset();
        idEl.readOnly = false;
        delete form.dataset.editId;
    }
    form.style.display = "block";
}

function hideSenderForm() {
    const form = document.getElementById("senderForm");
    if (!form) {
        return;
    }
    form.style.display = "none";
    const formData = document.getElementById("senderFormData");
    if (formData) {
        formData.reset();
    }
    delete form.dataset.editId;
}

async function saveSender() {
    const form = document.getElementById("senderForm");
    const senderData = {
        sender_id: document.getElementById("senderInfoId").value,
        shipping_address: document.getElementById("senderInfoAddress").value,
        sender_name: document.getElementById("senderInfoName").value,
        sender_phone: document.getElementById("senderInfoPhone").value
    };

    if (!senderData.sender_id || senderData.sender_id.trim() === "") {
        showMessage("发件人ID不能为空", "error");
        return;
    }

    try {
        let response;
        if (form.dataset.editId) {
            response = await fetch(`${API_BASE}/senders/${encodeURIComponent(form.dataset.editId)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(senderData)
            });
        } else {
            response = await fetch(`${API_BASE}/senders`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(senderData)
            });
        }

        if (response.ok) {
            showMessage("发件人信息保存成功");
            hideSenderForm();
            loadSenders();
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

async function editSender(id) {
    try {
        const response = await fetch(`${API_BASE}/senders/${encodeURIComponent(id)}`);
        const data = await response.json();
        if (!response.ok) {
            showMessage(data.error || "加载发件人信息失败", "error");
            return;
        }
        showSenderForm(data.sender);
    } catch (error) {
        showMessage("加载发件人信息失败: " + error.message, "error");
    }
}

async function deleteSender(id) {
    if (!confirm("确定删除此发件人吗？")) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/senders/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (response.ok) {
            showMessage("发件人删除成功");
            loadSenders();
        } else {
            const error = await response.json();
            showMessage("删除失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("删除失败: " + error.message, "error");
    }
}

function searchSenders() {
    currentSenderSearchTerm = (document.getElementById("senderSearchInput")?.value || "").trim();
    loadAndFilterSenders();
}

async function loadAndFilterSenders() {
    try {
        const response = await fetch(`${API_BASE}/senders`);
        const data = await response.json();
        let filtered = data.senders || [];

        if (currentSenderSearchTerm) {
            const keyword = currentSenderSearchTerm.toLowerCase();
            filtered = filtered.filter(item =>
                (item.sender_id && item.sender_id.toLowerCase().includes(keyword)) ||
                (item.sender_name && item.sender_name.toLowerCase().includes(keyword)) ||
                (item.sender_phone && item.sender_phone.toLowerCase().includes(keyword)) ||
                (item.shipping_address && item.shipping_address.toLowerCase().includes(keyword))
            );
        }

        displaySenders(filtered);
    } catch (error) {
        showMessage("加载发件人信息失败: " + error.message, "error");
    }
}

async function previewSenderExcel() {
    const fileInput = document.getElementById("senderExcelFile");
    if (!fileInput.files || fileInput.files.length === 0) {
        showSenderImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    try {
        showSenderImportMessage("正在解析Excel文件...", "info");
        const formData = new FormData();
        formData.append("excelFile", fileInput.files[0]);
        const response = await fetch(`${API_BASE}/senders/parse-excel`, { method: "POST", body: formData });
        const result = await response.json();

        if (response.ok && result.success) {
            showSenderForm(result.data);
            showSenderImportMessage("数据预览成功！请检查后保存或批量导入。", "success");
        } else {
            showSenderImportMessage(result.error || "预览失败", "error");
        }
    } catch (error) {
        showSenderImportMessage("网络错误: " + error.message, "error");
    }
}

async function importSenderExcelBatch() {
    const fileInput = document.getElementById("senderExcelFile");
    if (!fileInput.files || fileInput.files.length === 0) {
        showSenderImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    try {
        showSenderImportMessage("正在批量导入发件人信息Excel数据...", "info");
        const formData = new FormData();
        formData.append("excelFile", fileInput.files[0]);
        const response = await fetch(`${API_BASE}/senders/import-excel`, { method: "POST", body: formData });
        const result = await response.json();

        if (response.ok) {
            displayLibraryImportResults(result, "senderImportResults", "senderImportSummary", "senderImportErrors");
            showSenderImportMessage(result.message, result.success ? "success" : "error");
            if (result.results && result.results.success > 0) {
                loadSenders();
            }
        } else {
            showSenderImportMessage(result.error || "批量导入失败", "error");
        }
    } catch (error) {
        showSenderImportMessage("网络错误: " + error.message, "error");
    }
}

async function loadCustomers() {
    try {
        const response = await fetch(`${API_BASE}/customers`);
        const data = await response.json();
        displayCustomers(data.customers || []);
    } catch (error) {
        showMessage("加载客户信息失败: " + error.message, "error");
    }
}

function displayCustomers(customers) {
    customersData = customers; // 保存客户数据到全局变量
    const tbody = document.querySelector("#customersTable tbody");
    if (!tbody) {
        return;
    }
    tbody.innerHTML = "";
    customers.forEach(customer => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${customer.customer_id || ""}</td>
            <td>${customer.delivery_address || ""}</td>
            <td>${customer.receiver_name || ""}</td>
            <td>${customer.receiver_phone || ""}</td>
            <td>
                <button onclick="editCustomer('${customer.customer_id}')">编辑</button>
                <button onclick="deleteCustomer('${customer.customer_id}')">删除</button>
            </td>
        `;
    });
}

function showCustomerForm(customer = null) {
    const form = document.getElementById("customerForm");
    if (!form) {
        return;
    }
    const idEl = document.getElementById("customerInfoId");
    if (customer) {
        idEl.value = customer.customer_id || "";
        document.getElementById("customerInfoAddress").value = customer.delivery_address || "";
        document.getElementById("customerInfoReceiver").value = customer.receiver_name || "";
        document.getElementById("customerInfoPhone").value = customer.receiver_phone || "";
        idEl.readOnly = true;
        form.dataset.editId = customer.customer_id;
    } else {
        document.getElementById("customerFormData").reset();
        idEl.readOnly = false;
        delete form.dataset.editId;
    }
    form.style.display = "block";
}

function hideCustomerForm() {
    const form = document.getElementById("customerForm");
    if (!form) {
        return;
    }
    form.style.display = "none";
    const formData = document.getElementById("customerFormData");
    if (formData) {
        formData.reset();
    }
    delete form.dataset.editId;
}

async function saveCustomer() {
    const form = document.getElementById("customerForm");
    const customerData = {
        customer_id: document.getElementById("customerInfoId").value,
        delivery_address: document.getElementById("customerInfoAddress").value,
        receiver_name: document.getElementById("customerInfoReceiver").value,
        receiver_phone: document.getElementById("customerInfoPhone").value
    };

    if (!customerData.customer_id || customerData.customer_id.trim() === "") {
        showMessage("客户ID不能为空", "error");
        return;
    }

    try {
        let response;
        if (form.dataset.editId) {
            response = await fetch(`${API_BASE}/customers/${encodeURIComponent(form.dataset.editId)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(customerData)
            });
        } else {
            response = await fetch(`${API_BASE}/customers`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(customerData)
            });
        }

        if (response.ok) {
            showMessage("客户信息保存成功");
            hideCustomerForm();
            loadCustomers();
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

async function editCustomer(id) {
    try {
        const response = await fetch(`${API_BASE}/customers/${encodeURIComponent(id)}`);
        const data = await response.json();
        if (!response.ok) {
            showMessage(data.error || "加载客户信息失败", "error");
            return;
        }
        showCustomerForm(data.customer);
    } catch (error) {
        showMessage("加载客户信息失败: " + error.message, "error");
    }
}

async function deleteCustomer(id) {
    if (!confirm("确定删除此客户吗？")) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/customers/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (response.ok) {
            showMessage("客户删除成功");
            loadCustomers();
        } else {
            const error = await response.json();
            showMessage("删除失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("删除失败: " + error.message, "error");
    }
}

function searchCustomers() {
    currentCustomerSearchTerm = (document.getElementById("customerSearchInput")?.value || "").trim();
    loadAndFilterCustomers();
}

async function loadAndFilterCustomers() {
    try {
        const response = await fetch(`${API_BASE}/customers`);
        const data = await response.json();
        let filtered = data.customers || [];

        if (currentCustomerSearchTerm) {
            const keyword = currentCustomerSearchTerm.toLowerCase();
            filtered = filtered.filter(item =>
                (item.customer_id && item.customer_id.toLowerCase().includes(keyword)) ||
                (item.delivery_address && item.delivery_address.toLowerCase().includes(keyword)) ||
                (item.receiver_name && item.receiver_name.toLowerCase().includes(keyword)) ||
                (item.receiver_phone && item.receiver_phone.toLowerCase().includes(keyword))
            );
        }

        displayCustomers(filtered);
    } catch (error) {
        showMessage("加载客户信息失败: " + error.message, "error");
    }
}

async function previewCustomerExcel() {
    const fileInput = document.getElementById("customerExcelFile");
    if (!fileInput.files || fileInput.files.length === 0) {
        showCustomerImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    try {
        showCustomerImportMessage("正在解析Excel文件...", "info");
        const formData = new FormData();
        formData.append("excelFile", fileInput.files[0]);
        const response = await fetch(`${API_BASE}/customers/parse-excel`, { method: "POST", body: formData });
        const result = await response.json();

        if (response.ok && result.success) {
            showCustomerForm(result.data);
            showCustomerImportMessage("数据预览成功！请检查后保存或批量导入。", "success");
        } else {
            showCustomerImportMessage(result.error || "预览失败", "error");
        }
    } catch (error) {
        showCustomerImportMessage("网络错误: " + error.message, "error");
    }
}

async function importCustomerExcelBatch() {
    const fileInput = document.getElementById("customerExcelFile");
    if (!fileInput.files || fileInput.files.length === 0) {
        showCustomerImportMessage("请选择要导入的Excel文件", "error");
        return;
    }

    try {
        showCustomerImportMessage("正在批量导入客户信息Excel数据...", "info");
        const formData = new FormData();
        formData.append("excelFile", fileInput.files[0]);
        const response = await fetch(`${API_BASE}/customers/import-excel`, { method: "POST", body: formData });
        const result = await response.json();

        if (response.ok) {
            displayLibraryImportResults(result, "customerImportResults", "customerImportSummary", "customerImportErrors");
            showCustomerImportMessage(result.message, result.success ? "success" : "error");
            if (result.results && result.results.success > 0) {
                loadCustomers();
            }
        } else {
            showCustomerImportMessage(result.error || "批量导入失败", "error");
        }
    } catch (error) {
        showCustomerImportMessage("网络错误: " + error.message, "error");
    }
}

// Page navigation functions
function showPage(pageName) {
    const importBar = document.getElementById("ordersImportBar");
    const importResults = document.getElementById("importResults");
    if (importBar) {
        importBar.style.display = pageName === "viewOrders" ? "flex" : "none";
    }
    if (importResults && pageName !== "viewOrders") {
        importResults.style.display = "none";
    }

    // Hide all pages
    const pages = document.querySelectorAll(".page");
    pages.forEach(page => {
        page.style.display = "none";
    });

    // Remove active class from all menu links
    const menuLinks = document.querySelectorAll(".sidebar a");
    menuLinks.forEach(link => {
        link.classList.remove("active");
    });

    // Show selected page and activate menu link
    if (pageName === "viewOrders") {
        document.getElementById("viewOrdersPage").style.display = "block";
        document.getElementById("viewOrdersLink").classList.add("active");
        loadOrders();
    } else if (pageName === "orderDetail") {
        document.getElementById("orderDetailPage").style.display = "block";
        document.getElementById("viewOrdersLink").classList.add("active");
    } else if (pageName === "packaging") {
        document.getElementById("packagingPage").style.display = "block";
        document.getElementById("packagingLink").classList.add("active");
        loadPackages();
    } else if (pageName === "pickupTracking") {
        document.getElementById("pickupTrackingPage").style.display = "block";
        document.getElementById("pickupTrackingLink").classList.add("active");
        loadPickupTrackings();
    } else if (pageName === "customs") {
        document.getElementById("customsPage").style.display = "block";
        document.getElementById("customsLink").classList.add("active");
        loadCustomsClearance();
    } else if (pageName === "logistics") {
        document.getElementById("logisticsPage").style.display = "block";
        document.getElementById("logisticsLink").classList.add("active");
        loadTransfers();
    } else if (pageName === "billing") {
        document.getElementById("billingPage").style.display = "block";
        document.getElementById("billingLink").classList.add("active");
    } else if (pageName === "senderDB") {
        document.getElementById("senderDBPage").style.display = "block";
        document.getElementById("senderDBLink").classList.add("active");
        loadSenders();
    } else if (pageName === "customerDB") {
        document.getElementById("customerDBPage").style.display = "block";
        document.getElementById("customerDBLink").classList.add("active");
        loadCustomers();
    } else if (pageName === "productDB") {
        document.getElementById("productDBPage").style.display = "block";
        document.getElementById("productDBLink").classList.add("active");
    } else if (pageName === "packagingDB") {
        document.getElementById("packagingDBPage").style.display = "block";
        document.getElementById("packagingDBLink").classList.add("active");
        loadPackagingDb();
    } else if (pageName === "userManagement") {
        document.getElementById("userManagementPage").style.display = "block";
        document.getElementById("userManagementLink").classList.add("active");
        loadUsers();
    }
}

// Load initial data when page loads
window.onload = function() {
    checkAuthState();

    initReceiveDateInputs();

    // Add event listener for search input (Enter key)
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchOrders();
            }
        });
    }

    // Add event listener for package search input (Enter key)
    const packageSearchInput = document.getElementById("packageSearchInput");
    if (packageSearchInput) {
        packageSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchPackages();
            }
        });
    }

    // Add event listener for transfer search input (Enter key)
    const transferSearchInput = document.getElementById("transferSearchInput");
    if (transferSearchInput) {
        transferSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchTransfers();
            }
        });
    }

    // Add event listener for pickup tracking search input (Enter key)
    const pickupTrackingSearchInput = document.getElementById("pickupTrackingSearchInput");
    if (pickupTrackingSearchInput) {
        pickupTrackingSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchPickupTrackings();
            }
        });
    }

    // Add event listener for sender search input (Enter key)
    const senderSearchInput = document.getElementById("senderSearchInput");
    if (senderSearchInput) {
        senderSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchSenders();
            }
        });
    }

    // Add event listener for customer search input (Enter key)
    const customerSearchInput = document.getElementById("customerSearchInput");
    if (customerSearchInput) {
        customerSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchCustomers();
            }
        });
    }

    // Add event listener for customs clearance search input (Enter key)
    const customsSearchInput = document.getElementById("customsSearchInput");
    if (customsSearchInput) {
        customsSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchCustomsClearance();
            }
        });
    }
};

// ==================== 报关信息维护跟踪功能 ====================

let currentCustomsSearchTerm = "";

async function loadCustomsClearance() {
    try {
        const response = await fetch(`${API_BASE}/customs-clearance`);
        const data = await response.json();
        displayCustomsClearance(data.records);
    } catch (error) {
        showMessage("加载报关信息失败: " + error.message, "error");
    }
}

function displayCustomsClearance(records) {
    const tbody = document.querySelector("#customsTable tbody");
    tbody.innerHTML = "";
    records.forEach(record => {
        const row = tbody.insertRow();

        row.innerHTML = `
            <td>${record.serial_number || ""}</td>
            <td>${record.company_name || ""}</td>
            <td>${record.orderer || ""}</td>
            <td>${record.business_type || ""}</td>
            <td>${record.sender_id || ""}</td>
            <td>${record.customer_id || ""}</td>
            <td>${formatDateOnly(record.receive_date)}</td>
            <td>${getOrderDisplayOrigin(record)}</td>
            <td>${getOrderDisplayDestination(record)}</td>
            <td>${record.trade_term || ""}</td>
            <td>${getOrderDisplayProductName(record)}</td>
            <td>${record.transport_mode || ""}</td>
            <td>${record.tracking_number || ""}</td>
            <td>${formatDateOnly(record.customs_start_time)}</td>
            <td>${formatDateOnly(record.tax_payment_time)}</td>
            <td>${formatDateOnly(record.release_time)}</td>
            <td>${record.customs_declaration_number || ""}</td>
            <td>
                <button onclick="editCustomsClearance(${record.id})">编辑</button>
            </td>
        `;
    });
}

async function editCustomsClearance(id) {
    try {
        const response = await fetch(`${API_BASE}/customs-clearance/${id}`);
        const data = await response.json();
        showCustomsForm(data.record);
    } catch (error) {
        showMessage("加载报关信息失败: " + error.message, "error");
    }
}

function showCustomsForm(recordData = null) {
    // 创建报关信息编辑弹窗
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "customsModal";
    modal.onclick = function(event) {
        if (event.target === modal) hideCustomsForm();
    };

    // 判断是否为只读模式（从订单详情调用）
    const isReadOnlyMode = Boolean(recordData && recordData.serial_number);

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>修改报关信息</h3>
                <button class="modal-close" onclick="hideCustomsForm()">&times;</button>
            </div>
            <form id="customsFormData">
                <input type="hidden" id="customsId">
                <div class="form-group">
                    <label>流水号:</label>
                    <input type="text" id="customsSerialNumber" required ${isReadOnlyMode ? 'readonly' : ''}>
                </div>
                <div class="form-group">
                    <label>开始报关时间:</label>
                    <div class="date-input-group">
                        <input type="text" id="customsStartTimeYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="customsStartTimeMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="customsStartTimeDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="customsStartTime">
                        <input type="date" id="customsStartTimePicker" class="date-picker-trigger" aria-label="选择开始报关时间">
                    </div>
                </div>
                <div class="form-group">
                    <label>付税时间:</label>
                    <div class="date-input-group">
                        <input type="text" id="taxPaymentTimeYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="taxPaymentTimeMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="taxPaymentTimeDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="taxPaymentTime">
                        <input type="date" id="taxPaymentTimePicker" class="date-picker-trigger" aria-label="选择付税时间">
                    </div>
                </div>
                <div class="form-group">
                    <label>放行时间:</label>
                    <div class="date-input-group">
                        <input type="text" id="releaseTimeYear" class="date-input" placeholder="YYYY" inputmode="numeric" maxlength="4">
                        <span class="date-separator">/</span>
                        <input type="text" id="releaseTimeMonth" class="date-input" placeholder="MM" inputmode="numeric" maxlength="2">
                        <span class="date-separator">/</span>
                        <input type="text" id="releaseTimeDay" class="date-input" placeholder="DD" inputmode="numeric" maxlength="2">
                        <input type="hidden" id="releaseTime">
                        <input type="date" id="releaseTimePicker" class="date-picker-trigger" aria-label="选择放行时间">
                    </div>
                </div>
                <div class="form-group">
                    <label>报关单号:</label>
                    <input type="text" id="customsDeclarationNumber">
                </div>
                <div class="form-group">
                    <label>报关供应商:</label>
                    <input type="text" id="customsSupplier">
                </div>
                <div class="form-group">
                    <label>备注1:</label>
                    <textarea id="customsRemark1"></textarea>
                </div>
                <div class="form-group">
                    <label>备注2:</label>
                    <textarea id="customsRemark2"></textarea>
                </div>
                <div class="button-group">
                    <button type="button" onclick="saveCustomsClearance()">保存</button>
                    <button type="button" onclick="hideCustomsForm()">取消</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    const form = modal.querySelector("#customsFormData");
    setupTransferDateInput("customsStartTime", form, updateTransferDateHidden);
    setupTransferDateInput("taxPaymentTime", form, updateTransferDateHidden);
    setupTransferDateInput("releaseTime", form, updateTransferDateHidden);

    const fillCustomsFormFields = (data) => {
        if (!data) {
            return;
        }
        document.getElementById("customsId").value = data.id || "";
        setTransferDateValue("customsStartTime", data.customs_start_time, form);
        setTransferDateValue("taxPaymentTime", data.tax_payment_time, form);
        setTransferDateValue("releaseTime", data.release_time, form);
        fillSharedFormFields(form, CUSTOMS_TRACKING_SHARED_FORM_FIELDS, data);
    };

    const clearCustomsFormFields = () => {
        document.getElementById("customsId").value = "";
        setTransferDateValue("customsStartTime", "", form);
        setTransferDateValue("taxPaymentTime", "", form);
        setTransferDateValue("releaseTime", "", form);
        clearSharedFormFields(form, CUSTOMS_TRACKING_SHARED_FORM_FIELDS);
    };

    // 填充表单数据
    if (recordData) {
        document.getElementById("customsSerialNumber").value = recordData.serial_number || "";
        fillCustomsFormFields(recordData);
    }

    const serialInput = document.getElementById("customsSerialNumber");
    let customsSerialTimer = null;
    let lastCustomsSerial = serialInput.value.trim();

    const loadCustomsBySerial = async () => {
        const serial = serialInput.value.trim();
        if (!serial) {
            clearCustomsFormFields();
            return;
        }
        if (serial === lastCustomsSerial) {
            return;
        }
        lastCustomsSerial = serial;
        try {
            const response = await fetch(`${API_BASE}/customs-clearance/serial/${encodeURIComponent(serial)}`);
            if (!response.ok) {
                if (response.status === 404) {
                    // 流水号不存在，清空表单，允许用户创建新记录
                    clearCustomsFormFields();
                    return;
                }
                showMessage("加载报关信息失败", "error");
                clearCustomsFormFields();
                return;
            }
            const data = await response.json();
            if (data && data.record) {
                fillCustomsFormFields(data.record);
            } else {
                clearCustomsFormFields();
            }
        } catch (error) {
            console.log("加载报关信息失败: " + error.message);
            clearCustomsFormFields();
        }
    };

    // 只有在非readonly模式下才添加自动加载事件监听器
    if (!isReadOnlyMode) {
        serialInput.addEventListener("change", loadCustomsBySerial);
        serialInput.addEventListener("blur", loadCustomsBySerial);
        serialInput.addEventListener("input", () => {
            clearTimeout(customsSerialTimer);
            customsSerialTimer = setTimeout(loadCustomsBySerial, 500);
        });
    }

    modal.style.display = "block";
}

function hideCustomsForm() {
    const modal = document.getElementById("customsModal");
    if (modal) {
        modal.remove();
    }
}

async function saveCustomsClearance() {
    const form = document.getElementById("customsFormData");
    const id = document.getElementById("customsId").value;
    const serialNumber = document.getElementById("customsSerialNumber").value.trim();

    if (!serialNumber) {
        showMessage("流水号不能为空", "error");
        return;
    }

    if (form) {
        updateTransferDateHidden("customsStartTime", form);
        updateTransferDateHidden("taxPaymentTime", form);
        updateTransferDateHidden("releaseTime", form);
    }

    const sharedPayload = collectSharedFormPayload(form, CUSTOMS_TRACKING_SHARED_FORM_FIELDS, { trim: true, nullIfEmpty: true });
    const recordData = {
        serial_number: serialNumber,
        customs_start_time: document.getElementById("customsStartTime").value || null,
        tax_payment_time: document.getElementById("taxPaymentTime").value || null,
        release_time: document.getElementById("releaseTime").value || null,
        ...sharedPayload
    };

    try {
        let response;
        if (id) {
            // 更新现有记录
            response = await fetch(`${API_BASE}/customs-clearance/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(recordData)
            });
        } else {
            // 检查流水号是否已存在
            const checkResponse = await fetch(`${API_BASE}/customs-clearance/serial/${encodeURIComponent(serialNumber)}`);
            if (checkResponse.ok) {
                // 记录已存在，使用PUT更新
                const existingData = await checkResponse.json();
                response = await fetch(`${API_BASE}/customs-clearance/${existingData.record.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(recordData)
                });
            } else if (checkResponse.status === 404) {
                // 记录不存在，创建新记录
                response = await fetch(`${API_BASE}/customs-clearance`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(recordData)
                });
            } else {
                showMessage("检查流水号失败", "error");
                return;
            }
        }

        if (response.ok) {
            showMessage("报关信息保存成功");
            hideCustomsForm();
            loadCustomsClearance();
            if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
                loadOrderCustomsClearanceDetails(serialNumber);
            }
        } else {
            const error = await response.json();
            showMessage("保存失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("保存失败: " + error.message, "error");
    }
}

async function deleteCustomsClearance(id) {
    if (!confirm("确定要删除这条报关信息吗？")) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/customs-clearance/${id}`, {
            method: "DELETE"
        });

        if (response.ok) {
            showMessage("报关信息删除成功");
            loadCustomsClearance();
        } else {
            const error = await response.json();
            showMessage("删除失败: " + error.error, "error");
        }
    } catch (error) {
        showMessage("删除失败: " + error.message, "error");
    }
}

function searchCustomsClearance() {
    currentCustomsSearchTerm = document.getElementById("customsSearchInput").value.trim();
    loadAndFilterCustomsClearance();
}

async function loadAndFilterCustomsClearance() {
    try {
        const response = await fetch(`${API_BASE}/customs-clearance`);
        const data = await response.json();

        let filteredRecords = data.records;

        // Apply search term
        if (currentCustomsSearchTerm) {
            const searchLower = currentCustomsSearchTerm.toLowerCase();
            filteredRecords = filteredRecords.filter(record => {
                return (record.serial_number && record.serial_number.toLowerCase().includes(searchLower)) ||
                       (record.company_name && record.company_name.toLowerCase().includes(searchLower)) ||
                       (record.orderer && record.orderer.toLowerCase().includes(searchLower)) ||
                       (record.business_type && record.business_type.toLowerCase().includes(searchLower)) ||
                       (record.sender_id && record.sender_id.toLowerCase().includes(searchLower)) ||
                       (record.customer_id && record.customer_id.toLowerCase().includes(searchLower)) ||
                       (record.trade_term && record.trade_term.toLowerCase().includes(searchLower)) ||
                       (getOrderDisplayOrigin(record) && getOrderDisplayOrigin(record).toLowerCase().includes(searchLower)) ||
                       (getOrderDisplayDestination(record) && getOrderDisplayDestination(record).toLowerCase().includes(searchLower)) ||
                       (getOrderDisplayProductName(record) && getOrderDisplayProductName(record).toLowerCase().includes(searchLower)) ||
                       (record.customs_declaration_number && record.customs_declaration_number.toLowerCase().includes(searchLower));
            });
        }

        displayCustomsClearance(filteredRecords);
    } catch (error) {
        showMessage("加载报关信息失败: " + error.message, "error");
    }
}
