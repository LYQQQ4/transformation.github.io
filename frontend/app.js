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
let currentOrderBillingData = null;
let currentBillingSerialNumber = "";
const ORDER_SUMMARY_FIELD_API = window.OrderSummaryFields || null;

const BILLING_FEE_CATEGORIES = [
    "提货运输费",
    "出口报关操作费",
    "空运单价/kg",
    "国际运费",
    "THC操作费",
    "清关费",
    "送货运输费",
    "其他杂费",
    "增值服务费",
    "代垫费",
    "费用小计",
    "含税价"
];

const BILLING_FEE_FIELDS = [
    { key: "fee_detail", label: "费用明细" },
    { key: "amount", label: "金额" },
    { key: "tax_rate", label: "税率" },
    { key: "supplier", label: "供应商" },
    { key: "exchange_rate", label: "汇率" },
    { key: "remark", label: "备注" },
    { key: "billing_period", label: "账期" }
];

const SHARED_TRACKING_FIELD_DEFINITIONS = {
    transport_mode: { label: "运输方式" },
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
    transport_mode: "#customsTransportMode",
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
    updateDeleteOrdersMenuVisibility();
    updateBatchReceiveDateControlsVisibility();
    updateAllBatchDateControlsVisibility();
    updateOrderBatchDateFieldOptions();
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
    updateDeleteOrdersMenuVisibility();
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
const ORDER_PAGE_VIEW = "viewOrders";
const ORDER_PAGE_DELETE = "deleteOrders";
let activeOrderPageContext = ORDER_PAGE_VIEW;
const selectedOrderSerialNumbers = new Set();
let orderBatchDateSubmitting = false;
/*
    order: {
        endpoint: `${API_BASE}/orders/batch-date`,
        fields: {
            receive_date: { label: "\u63a5\u6536\u6307\u4ee4\u65e5\u671f", includeTime: false }
        }
    },
    pickup: {
        endpoint: `${API_BASE}/pickup-trackings/batch-date`,
        fields: {
            pickup_date: { label: "\u63d0\u8d27\u65e5\u671f", includeTime: false },
            arrival_time: { label: "\u5230\u8d27\u65f6\u95f4", includeTime: true }
        }
    },
    customs: {
        endpoint: `${API_BASE}/customs-clearance/batch-date`,
        fields: {
            customs_start_time: { label: "\u62a5\u5173\u5f00\u59cb\u65f6\u95f4", includeTime: true },
            tax_payment_time: { label: "\u7f34\u7a0e\u65f6\u95f4", includeTime: true },
            release_time: { label: "\u653e\u884c\u65f6\u95f4", includeTime: true }
        }
    },
    transfer: {
        endpoint: `${API_BASE}/transfers/batch-date`,
        fields: {
            pickup_date: { label: "\u63d0\u8d27\u65e5\u671f", includeTime: false },
            arrival_port_time: { label: "\u5230\u8d27\u65f6\u95f4", includeTime: true },
            clearance_time: { label: "\u653e\u884c\u65f6\u95f4", includeTime: true },
            delivery_time: { label: "\u9001\u8fbe\u65f6\u95f4", includeTime: true },
            complete_docs_send_time: { label: "\u5b8c\u6574\u5355\u636e\u56de\u590d\u65f6\u95f4", includeTime: true }
        }
    },
    billing: {
        endpoint: `${API_BASE}/billing/batch-date`,
        fields: {
            billing_completed_time: { label: "\u8d26\u5355\u5b8c\u6210\u65f6\u95f4", includeTime: false }
        }
    }
*/
const orderBatchDateFieldMap = {
    receive_date: { label: "\u63a5\u6536\u6307\u4ee4\u65e5\u671f", includeTime: false },
    pickup_date: { label: "\u63d0\u8d27\u65e5\u671f", includeTime: false },
    pickup_arrival_time: { label: "\u63d0\u8d27\u8ddf\u8e2a\u5230\u8d27\u65f6\u95f4", includeTime: true },
    customs_start_time: { label: "\u62a5\u5173\u5f00\u59cb\u65f6\u95f4", includeTime: true },
    tax_payment_time: { label: "\u7f34\u7a0e\u65f6\u95f4", includeTime: true },
    release_time: { label: "\u62a5\u5173\u653e\u884c\u65f6\u95f4", includeTime: true },
    transfer_pickup_date: { label: "\u8fd0\u8f93\u63d0\u8d27\u65e5\u671f", includeTime: false },
    arrival_port_time: { label: "\u8fd0\u8f93\u5230\u6e2f\u65f6\u95f4", includeTime: true },
    clearance_time: { label: "\u8fd0\u8f93\u653e\u884c\u65f6\u95f4", includeTime: true },
    delivery_time: { label: "\u8fd0\u8f93\u9001\u8fbe\u65f6\u95f4", includeTime: true },
    complete_docs_send_time: { label: "\u5b8c\u6574\u5355\u636e\u56de\u590d\u65f6\u95f4", includeTime: true },
    billing_completed_time: { label: "\u8d26\u5355\u5b8c\u6210\u65e5\u671f", includeTime: false }
};

const orderPageState = {
    [ORDER_PAGE_VIEW]: {
        filters: {},
        searchTerm: "",
        tableId: "ordersTable",
        searchInputId: "searchInput",
        allowsEdit: true,
        allowsDelete: false,
        actionHeader: "操作",
        loadButtonHandler: "loadOrders()"
    },
    [ORDER_PAGE_DELETE]: {
        filters: {},
        searchTerm: "",
        tableId: "deleteOrdersTable",
        searchInputId: "deleteOrdersSearchInput",
        allowsEdit: false,
        allowsDelete: true,
        actionHeader: "危险操作",
        loadButtonHandler: "loadDeleteOrders()"
    }
};
let currentPackageSearchTerm = "";
const PACKAGE_PAGE_SIZE = 15;
let currentPackagePage = 1;
let currentPackageDisplayGroups = [];
const TABLE_PAGE_SIZE = 15;
const tablePaginationStates = new Map();
let currentPickupTrackingSearchTerm = "";
let currentTransferSearchTerm = "";
let currentGuestSearchTerm = "";

function getTablePaginationContainerId(tableId) {
    return `${tableId}Pagination`;
}

function ensureTablePaginationContainer(tableId) {
    const table = document.getElementById(tableId);
    if (!table) {
        return null;
    }

    const containerId = getTablePaginationContainerId(tableId);
    let container = document.getElementById(containerId);
    if (!container) {
        container = document.createElement("div");
        container.id = containerId;
        container.style.cssText = "display: none; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 16px;";
        table.insertAdjacentElement("afterend", container);
    }
    return container;
}

function renderTablePagination(tableId, totalCount, currentPage, totalPages) {
    const container = ensureTablePaginationContainer(tableId);
    if (!container) {
        return;
    }

    container.style.display = "flex";
    container.innerHTML = `
        <span>共 ${totalCount} 条，第 ${currentPage} / ${totalPages} 页</span>
        <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" onclick="changeTablePage('${tableId}', ${currentPage - 1})" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
            <button type="button" onclick="changeTablePage('${tableId}', ${currentPage + 1})" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
    `;
}

function applyRenderedTablePagination(tableId, resetPage = true) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) {
        return;
    }

    const state = tablePaginationStates.get(tableId) || { page: 1, rows: [] };
    state.rows = Array.from(tbody.rows);
    if (resetPage) {
        state.page = 1;
    }

    const totalPages = Math.max(1, Math.ceil(state.rows.length / TABLE_PAGE_SIZE));
    state.page = Math.min(Math.max(state.page, 1), totalPages);
    tablePaginationStates.set(tableId, state);

    state.rows.forEach((row, index) => {
        const start = (state.page - 1) * TABLE_PAGE_SIZE;
        row.style.display = index >= start && index < start + TABLE_PAGE_SIZE ? "" : "none";
    });
    renderTablePagination(tableId, state.rows.length, state.page, totalPages);
}

function updateTablePaginationSelectionState(tableId) {
    if (tableId === "ordersTable") {
        updateOrderBatchDateSelectionState();
    }
}

function changeTablePage(tableId, page) {
    const state = tablePaginationStates.get(tableId);
    if (!state) {
        return;
    }

    const totalPages = Math.max(1, Math.ceil(state.rows.length / TABLE_PAGE_SIZE));
    const nextPage = Number(page);
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages) {
        return;
    }

    state.page = nextPage;
    state.rows.forEach((row, index) => {
        const start = (state.page - 1) * TABLE_PAGE_SIZE;
        row.style.display = index >= start && index < start + TABLE_PAGE_SIZE ? "" : "none";
    });
    renderTablePagination(tableId, state.rows.length, state.page, totalPages);
    updateTablePaginationSelectionState(tableId);
}
const REPORT_TYPE_TOTAL = "total";
const REPORT_EMPTY_VALUE_TEXT = "\u8be5\u9879\u672a\u586b";
const TOTAL_REPORT_FIELD_GROUPS = [{
    key: "order_summary",
    label: "\u8ba2\u5355\u6458\u8981",
    fields: ORDER_SUMMARY_FIELD_API?.ORDER_SUMMARY_FIELD_DEFINITIONS || []
}];

function getOrderSummaryFieldDefinitions() {
    return ORDER_SUMMARY_FIELD_API?.ORDER_SUMMARY_FIELD_DEFINITIONS || [];
}

function getOrderSummaryFieldValue(record, fieldKey) {
    return ORDER_SUMMARY_FIELD_API?.getOrderSummaryFieldValue?.(record || {}, fieldKey) ?? "";
}

function formatOrderSummaryFieldValue(fieldKey, value) {
    return ORDER_SUMMARY_FIELD_API?.formatOrderSummaryValue?.(fieldKey, value, {
        emptyValueText: REPORT_EMPTY_VALUE_TEXT
    }) ?? (value === undefined || value === null || value === "" ? REPORT_EMPTY_VALUE_TEXT : String(value));
}

function buildOrderSummaryDetailItems(record, serialNumber = "") {
    const summaryRecord = {
        ...(record || {}),
        serial_number: serialNumber || record?.serial_number || record?.id || ""
    };

    return getOrderSummaryFieldDefinitions().map((field) => [
        field.label,
        formatOrderSummaryFieldValue(field.key, getOrderSummaryFieldValue(summaryRecord, field.key))
    ]);
}

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

function getOrderPageState(pageName = activeOrderPageContext) {
    return orderPageState[pageName] || orderPageState[ORDER_PAGE_VIEW];
}

function isAdminUser() {
    return String(currentUser?.role || "").trim() === "admin";
}

function updateBatchReceiveDateControlsVisibility() {
    const controls = document.getElementById("orderBatchDateControls");
    if (!controls) {
        return;
    }

    controls.style.display = isAdminUser() ? "flex" : "none";
    if (!isAdminUser()) {
        clearOrderBatchSelection();
    } else {
        updateOrderBatchDateSelectionState();
    }
}

function updateAllBatchDateControlsVisibility() {
    updateBatchReceiveDateControlsVisibility();
}

function updateBatchReceiveDateSelectionState() {
    const checkboxes = Array.from(document.querySelectorAll("#ordersTable input[data-order-select]"));
    const selectAll = document.querySelector("#ordersTable input[data-order-select-all]");
    const countElement = document.getElementById("orderBatchDateSelectedCount");
    const submitButton = document.getElementById("orderBatchDateButton");
    const selectAllButton = document.getElementById("orderBatchDateSelectAllButton");
    const clearSelectionButton = document.getElementById("orderBatchDateClearSelectionButton");

    if (countElement) {
        countElement.textContent = String(selectedOrderSerialNumbers.size);
    }

    if (selectAll) {
        const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
        selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
        selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
    }

    const fieldConfig = getOrderBatchDateConfig().fieldConfig;
    const input = document.getElementById("orderBatchDateValue");
    const hasValue = Boolean(input?.value?.trim());
    if (submitButton) {
        submitButton.disabled = orderBatchDateSubmitting ||
            selectedOrderSerialNumbers.size === 0 ||
            !fieldConfig ||
            !hasValue;
    }
    if (selectAllButton) {
        selectAllButton.disabled = checkboxes.length === 0;
        selectAllButton.textContent = checkboxes.length > 0 &&
            selectedOrderSerialNumbers.size === checkboxes.length ? "取消全选" : "全选";
    }
    if (clearSelectionButton) {
        clearSelectionButton.disabled = selectedOrderSerialNumbers.size === 0;
    }
}

function clearOrderBatchSelection(clearDate = true) {
    selectedOrderSerialNumbers.clear();
    document.querySelectorAll("#ordersTable input[data-order-select]").forEach((checkbox) => {
        checkbox.checked = false;
    });
    const selectAll = document.querySelector("#ordersTable input[data-order-select-all]");
    if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    }
    if (clearDate) {
        const dateInput = document.getElementById("orderBatchDateValue");
        if (dateInput) {
            dateInput.value = "";
        }
    }
    updateOrderBatchDateSelectionState();
}

function handleOrderSelectionChange(checkbox) {
    const serialNumber = String(checkbox?.value || "").trim();
    if (!serialNumber) {
        return;
    }

    if (checkbox.checked) {
        selectedOrderSerialNumbers.add(serialNumber);
    } else {
        selectedOrderSerialNumbers.delete(serialNumber);
    }
    updateOrderBatchDateSelectionState();
}

function toggleAllOrderSelection(checkbox) {
    const items = Array.from(document.querySelectorAll("#ordersTable input[data-order-select]"));
    const checked = checkbox
        ? Boolean(checkbox.checked)
        : !(items.length > 0 && selectedOrderSerialNumbers.size === items.length);
    items.forEach((item) => {
        item.checked = checked;
        handleOrderSelectionChange(item);
    });
    updateOrderBatchDateSelectionState();
}

function getOrderBatchDateConfig() {
    const field = document.getElementById("orderBatchDateField")?.value || "";
    return {
        field,
        fieldConfig: orderBatchDateFieldMap[field] || null
    };
}

function updateOrderBatchDateFieldOptions() {
    const fieldInput = document.getElementById("orderBatchDateField");
    if (!fieldInput) {
        return;
    }

    const currentField = fieldInput.value;
    fieldInput.innerHTML = Object.entries(orderBatchDateFieldMap)
        .map(([field, definition]) => `<option value="${field}">${definition.label}</option>`)
        .join("");
    if (orderBatchDateFieldMap[currentField]) {
        fieldInput.value = currentField;
    }
    updateOrderBatchDateInputControl();
}

function updateOrderBatchDateInputControl() {
    const input = document.getElementById("orderBatchDateValue");
    const { fieldConfig } = getOrderBatchDateConfig();
    if (!input || !fieldConfig) {
        return;
    }

    input.type = fieldConfig.includeTime ? "datetime-local" : "date";
    input.step = fieldConfig.includeTime ? "1" : "1";
    input.value = "";
    updateOrderBatchDateSelectionState();
}

function updateOrderBatchDateSelectionState() {
    updateBatchReceiveDateSelectionState();
}

function isValidOrderBatchDateValue(value, includeTime) {
    const normalized = String(value || "").trim();
    const match = includeTime
        ? normalized.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/)
        : normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return false;
    }

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== Number(match[1]) ||
        date.getMonth() + 1 !== Number(match[2]) ||
        date.getDate() !== Number(match[3])
    ) {
        return false;
    }

    return !includeTime ||
        Number(match[4]) <= 23 &&
        Number(match[5]) <= 59 &&
        Number(match[6] || 0) <= 59;
}

async function batchUpdateOrderDate() {
    if (!isAdminUser()) {
        showMessage("仅管理员可批量修改日期", "error");
        return;
    }

    const { field, fieldConfig } = getOrderBatchDateConfig();
    const input = document.getElementById("orderBatchDateValue");
    const value = input?.value?.trim() || "";
    const serialNumbers = Array.from(selectedOrderSerialNumbers);
    if (serialNumbers.length === 0) {
        showMessage("请先选择要更新的流水号", "error");
        return;
    }
    if (!fieldConfig) {
        showMessage("请选择要修改的日期字段", "error");
        return;
    }
    if (!isValidOrderBatchDateValue(value, fieldConfig.includeTime)) {
        showMessage(`请输入有效的${fieldConfig.label}`, "error");
        return;
    }

    orderBatchDateSubmitting = true;
    updateOrderBatchDateSelectionState();
    try {
        const response = await fetch(`${API_BASE}/orders/batch-date`, {
            method: "PUT",
            headers: getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                field,
                serial_numbers: serialNumbers,
                value
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "批量修改日期失败");
        }

        const notFound = Array.isArray(data.not_found_serial_numbers)
            ? data.not_found_serial_numbers
            : [];
        clearOrderBatchSelection();
        await loadOrders(ORDER_PAGE_VIEW);
        const suffix = notFound.length > 0
            ? `，未找到流水号：${notFound.join("、")}`
            : "";
        showMessage(
            `${fieldConfig.label}已更新 ${data.updated_count || 0} 个流水号${suffix}`,
            notFound.length > 0 ? "info" : "success"
        );
    } catch (error) {
        showMessage(`批量修改${fieldConfig.label}失败: ${error.message}`, "error");
    } finally {
        orderBatchDateSubmitting = false;
        updateOrderBatchDateSelectionState();
    }
}

function getAuthHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (currentUser?.id) {
        headers["x-user-id"] = String(currentUser.id);
    }
    return headers;
}

function updateDeleteOrdersMenuVisibility() {
    const deleteOrdersLink = document.getElementById("deleteOrdersLink");
    if (deleteOrdersLink) {
        deleteOrdersLink.style.display = isAdminUser() ? "block" : "none";
    }

    const reportManagementLink = document.getElementById("reportManagementLink");
    if (reportManagementLink) {
        reportManagementLink.style.display = isAdminUser() ? "block" : "none";
    }
}

function showReportManagementMessage(message = "", type = "info") {
    const messageEl = document.getElementById("reportManagementMessage");
    if (!messageEl) {
        return;
    }
    messageEl.textContent = message;
    messageEl.className = type;
}

function buildReportFieldSelectorHtml() {
    return `
        <div id="reportFieldSelectorContainer" style="margin-bottom: 16px; padding: 16px; border: 1px solid #E5E7EB; border-radius: 8px; background: #F9FAFB;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;">
                <strong>\u8f93\u51fa\u9879\u9009\u62e9</strong>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button type="button" onclick="setAllReportFieldsSelected(true)">\u5168\u9009</button>
                    <button type="button" onclick="setAllReportFieldsSelected(false)">\u5168\u4e0d\u9009</button>
                </div>
            </div>
            <div style="display: grid; gap: 12px;">
                ${TOTAL_REPORT_FIELD_GROUPS.map((group) => `
                    <div data-report-field-group="${group.key}">
                        <div style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(group.label)}</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px 16px;">
                            ${group.fields.map((field) => `
                                <label style="display: inline-flex; align-items: center; gap: 6px; width: 220px; margin: 0;">
                                    <input type="checkbox" data-report-field-key="${escapeHtml(field.key)}" checked>
                                    <span>${escapeHtml(field.label)}</span>
                                </label>
                            `).join("")}
                        </div>
                    </div>
                `).join("")}
            </div>
        </div>
    `;
}

function ensureReportManagementFieldSelector() {
    const messageEl = document.getElementById("reportManagementMessage");
    if (!messageEl || document.getElementById("reportFieldSelectorContainer")) {
        return;
    }

    messageEl.insertAdjacentHTML("beforebegin", buildReportFieldSelectorHtml());
}

window.addEventListener("load", ensureReportManagementFieldSelector);

function getSelectedReportFieldKeys() {
    const checkboxes = document.querySelectorAll('#reportFieldSelectorContainer input[data-report-field-key]:checked');
    return Array.from(checkboxes).map((checkbox) => checkbox.dataset.reportFieldKey || "").filter(Boolean);
}

function setAllReportFieldsSelected(checked) {
    const checkboxes = document.querySelectorAll('#reportFieldSelectorContainer input[data-report-field-key]');
    checkboxes.forEach((checkbox) => {
        checkbox.checked = checked;
    });
}

function appendSelectedReportFields(params, selectedFieldKeys) {
    if (!Array.isArray(selectedFieldKeys)) {
        return;
    }

    params.set("selected_fields", JSON.stringify(selectedFieldKeys));
}

function getReportRequestUrl(reportType, serialNumber, selectedFieldKeys) {
    const params = new URLSearchParams();
    params.set("report_type", reportType || REPORT_TYPE_TOTAL);
    if (serialNumber) {
        params.set("serial_number", serialNumber);
    }
    appendSelectedReportFields(params, selectedFieldKeys);
    return `${API_BASE}/reports/summary?${params.toString()}`;
}

function getReportExportUrl(reportType, serialNumber, selectedFieldKeys) {
    const params = new URLSearchParams();
    params.set("report_type", reportType || REPORT_TYPE_TOTAL);
    if (serialNumber) {
        params.set("serial_number", serialNumber);
    }
    appendSelectedReportFields(params, selectedFieldKeys);
    return `${API_BASE}/reports/export?${params.toString()}`;
}

function formatReportCellValue(columnKey, value, emptyValueText = REPORT_EMPTY_VALUE_TEXT) {
    if (value === undefined || value === null || value === "") {
        return emptyValueText;
    }

    return String(value);
}

function renderReportTable(columns = [], rows = [], emptyValueText = REPORT_EMPTY_VALUE_TEXT) {
    const thead = document.querySelector("#reportManagementTable thead");
    const tbody = document.querySelector("#reportManagementTable tbody");

    if (!thead || !tbody) {
        return;
    }

    if (!columns.length) {
        thead.innerHTML = "";
        tbody.innerHTML = "";
        const pagination = document.getElementById(getTablePaginationContainerId("reportManagementTable"));
        if (pagination) {
            pagination.innerHTML = "";
            pagination.style.display = "none";
        }
        return;
    }

    thead.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label || column.key)}</th>`).join("")}</tr>`;
    tbody.innerHTML = rows.map((row) => {
        return `<tr>${columns.map((column) => {
            const value = formatReportCellValue(column.key, row?.[column.key], emptyValueText);
            return `<td>${escapeHtml(value)}</td>`;
        }).join("")}</tr>`;
    }).join("");
    applyRenderedTablePagination("reportManagementTable");
}

async function legacyQueryReports() {
    if (!isAdminUser()) {
        showMessage("仅管理员可使用报表管理", "error");
        showPage("viewOrders");
        return;
    }

    const reportType = document.getElementById("reportTypeSelect")?.value || REPORT_TYPE_TOTAL;
    const serialNumber = document.getElementById("reportSerialInput")?.value.trim() || "";

    try {
        showReportManagementMessage("正在查询报表...", "info");
        const response = await fetch(getReportRequestUrl(reportType, serialNumber), {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "查询报表失败");
        }

        renderReportTable(data.columns || [], data.rows || []);
        if ((data.rows || []).length === 0) {
            showReportManagementMessage("未查询到符合条件的报表数据", "info");
        } else {
            showReportManagementMessage(`已查询到 ${(data.rows || []).length} 条记录`, "success");
        }
    } catch (error) {
        renderReportTable([], []);
        showReportManagementMessage("查询报表失败: " + error.message, "error");
    }
}

async function legacyExportReports() {
    if (!isAdminUser()) {
        showMessage("仅管理员可使用报表管理", "error");
        showPage("viewOrders");
        return;
    }

    const reportType = document.getElementById("reportTypeSelect")?.value || REPORT_TYPE_TOTAL;
    const serialNumber = document.getElementById("reportSerialInput")?.value.trim() || "";

    try {
        showReportManagementMessage("正在导出报表...", "info");
        const response = await fetch(getReportExportUrl(reportType, serialNumber), {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            let errorMessage = "导出报表失败";
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch {
                // Keep the generic error when the server response is not JSON.
            }
            throw new Error(errorMessage);
        }

        const blob = await response.blob();
        if (!blob.size) {
            throw new Error("导出的报表为空");
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "report_export.xlsx";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showReportManagementMessage("报表导出成功", "success");
    } catch (error) {
        showReportManagementMessage("导出报表失败: " + error.message, "error");
    }
}

async function queryReports() {
    ensureReportManagementFieldSelector();

    if (!isAdminUser()) {
        showMessage("\u4ec5\u7ba1\u7406\u5458\u53ef\u4f7f\u7528\u62a5\u8868\u7ba1\u7406", "error");
        showPage("viewOrders");
        return;
    }

    const reportType = document.getElementById("reportTypeSelect")?.value || REPORT_TYPE_TOTAL;
    const serialNumber = document.getElementById("reportSerialInput")?.value.trim() || "";
    const selectedFieldKeys = getSelectedReportFieldKeys();

    if (selectedFieldKeys.length === 0) {
        renderReportTable([], []);
        showReportManagementMessage("\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9879\u8f93\u51fa\u5185\u5bb9", "info");
        return;
    }

    try {
        showReportManagementMessage("\u6b63\u5728\u67e5\u8be2\u62a5\u8868...", "info");
        const response = await fetch(getReportRequestUrl(reportType, serialNumber, selectedFieldKeys), {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "\u67e5\u8be2\u62a5\u8868\u5931\u8d25");
        }

        renderReportTable(
            data.columns || [],
            data.rows || [],
            data.empty_value_text || REPORT_EMPTY_VALUE_TEXT
        );
        if ((data.rows || []).length === 0) {
            showReportManagementMessage("\u672a\u67e5\u8be2\u5230\u7b26\u5408\u6761\u4ef6\u7684\u62a5\u8868\u6570\u636e", "info");
        } else {
            showReportManagementMessage(`\u5df2\u67e5\u8be2\u5230 ${(data.rows || []).length} \u6761\u8bb0\u5f55`, "success");
        }
    } catch (error) {
        renderReportTable([], []);
        showReportManagementMessage("\u67e5\u8be2\u62a5\u8868\u5931\u8d25: " + error.message, "error");
    }
}

async function exportReports() {
    ensureReportManagementFieldSelector();

    if (!isAdminUser()) {
        showMessage("\u4ec5\u7ba1\u7406\u5458\u53ef\u4f7f\u7528\u62a5\u8868\u7ba1\u7406", "error");
        showPage("viewOrders");
        return;
    }

    const reportType = document.getElementById("reportTypeSelect")?.value || REPORT_TYPE_TOTAL;
    const serialNumber = document.getElementById("reportSerialInput")?.value.trim() || "";
    const selectedFieldKeys = getSelectedReportFieldKeys();

    if (selectedFieldKeys.length === 0) {
        showReportManagementMessage("\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9879\u8f93\u51fa\u5185\u5bb9", "info");
        return;
    }

    try {
        showReportManagementMessage("\u6b63\u5728\u5bfc\u51fa\u62a5\u8868...", "info");
        const response = await fetch(getReportExportUrl(reportType, serialNumber, selectedFieldKeys), {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            let errorMessage = "\u5bfc\u51fa\u62a5\u8868\u5931\u8d25";
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch {
                // Keep the generic error when the server response is not JSON.
            }
            throw new Error(errorMessage);
        }

        const blob = await response.blob();
        if (!blob.size) {
            throw new Error("\u5bfc\u51fa\u7684\u62a5\u8868\u4e3a\u7a7a");
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "report_export.xlsx";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showReportManagementMessage("\u62a5\u8868\u5bfc\u51fa\u6210\u529f", "success");
    } catch (error) {
        showReportManagementMessage("\u5bfc\u51fa\u62a5\u8868\u5931\u8d25: " + error.message, "error");
    }
}

function buildOrderActionButtons(order, pageName = activeOrderPageContext) {
    const state = getOrderPageState(pageName);
    const actions = [];

    if (state.allowsEdit) {
        actions.push(`<button onclick="editOrder(${order.id})">编辑</button>`);
    }
    if (state.allowsDelete) {
        actions.push(`<button onclick="deleteOrderFromManagement(${order.id})">删除</button>`);
    }

    return actions.join("");
}

function ensureOrderIndexStructure(pageName = activeOrderPageContext) {
    const state = getOrderPageState(pageName);
    const tableHead = document.querySelector(`#${state.tableId} thead`);
    if (tableHead && !tableHead.textContent.includes("新增账单完成时间")) {
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

    if (tableHead && pageName === ORDER_PAGE_VIEW && !tableHead.querySelector("[data-order-select-all]")) {
        tableHead.querySelector("tr")?.insertAdjacentHTML(
            "afterbegin",
            '<th><input type="checkbox" data-order-select-all onchange="toggleAllOrderSelection(this)" aria-label="全选订单"></th>'
        );
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
async function loadOrders(pageName = ORDER_PAGE_VIEW) {
    try {
        activeOrderPageContext = pageName;
        ensureOrderIndexStructure(pageName);
        const query = buildOrderFilterQuery(pageName);
        const response = await fetch(query ? `${API_BASE}/orders?${query}` : `${API_BASE}/orders`);
        const data = await response.json();
        displayOrders(data.orders, pageName);
    } catch (error) {
        showMessage("加载订单失败: " + error.message, "error");
    }
}

function displayOrders(orders, pageName = activeOrderPageContext) {
    const state = getOrderPageState(pageName);
    if (pageName === ORDER_PAGE_VIEW) {
        clearOrderBatchSelection(false);
    }
    orders = Array.isArray(orders) ? orders : [];
    // 按照流水号从高到低排序
    orders.sort((a, b) => {
        const aSerial = parseInt(a.serial_number || a.id) || 0;
        const bSerial = parseInt(b.serial_number || b.id) || 0;
        return bSerial - aSerial; // 降序排列
    });

    const tbody = document.querySelector(`#${state.tableId} tbody`);
    tbody.innerHTML = "";
    orders.forEach(order => {
        const row = tbody.insertRow();
        const serialNumber = String(order.serial_number || order.id || "").trim();
        const selectionCell = pageName === ORDER_PAGE_VIEW
            ? `<td><input type="checkbox" data-order-select value="${escapeHtml(serialNumber)}" onchange="handleOrderSelectionChange(this)" aria-label="选择订单 ${escapeHtml(serialNumber)}"></td>`
            : "";

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
            ${selectionCell}
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
            <td>${formatDateOnly(order.pickup_date)}</td>
            <td>${formatDateOnly(order.customs_start_time)}</td>
            <td>${formatDateOnly(order.tax_payment_time)}</td>
            <td>${formatDateOnly(order.release_time)}</td>
            <td>${formatDateOnly(order.arrival_time)}</td>
            <td>${formatDateOnly(order.complete_docs_send_time)}</td>
            <td>${formatDateOnly(order.billing_completed_time)}</td>
            <td>${order.billing_period || ""}</td>
            <td>
                ${buildOrderActionButtons(order, pageName)}
            </td>
        `;
    });
    applyRenderedTablePagination(state.tableId);
}

function renderOrderDetailView(order) {
    const detailContent = document.getElementById("orderDetailContent");
    if (!detailContent) {
        showMessage("无法显示订单详情", "error");
        return;
    }

    const currentOrder = order || {};
    const serialNumber = currentOrder.serial_number || currentOrder.id || "";
    currentOrderDetailSerial = serialNumber;
    const summaryDetailItems = buildOrderSummaryDetailItems(currentOrder, serialNumber);

    detailContent.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(summaryDetailItems)}</div>
    `;

    const logisticsSection = document.getElementById("orderLogisticsSection");
    if (logisticsSection) {
        logisticsSection.style.display = "none";
    }

    ensureOrderBillingSection();
    showPage("orderDetail");
    loadOrderPackageDetails(serialNumber);
    loadOrderPickupTrackingDetails(serialNumber);
    loadOrderDeliveryTrackingDetails(serialNumber);
    loadOrderCustomsClearanceDetails(serialNumber);
    loadOrderBillingDetails(serialNumber);
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
        billing_completed_time: "",
        billing_period: "",
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

function calculatePackageItemVolumeTotal(item) {
    const volume = parseFloat(item?.volume || calculatePackageVolume(item));
    if (Number.isNaN(volume)) {
        return 0;
    }
    const pieces = parseFloat(item?.pieces);
    const safePieces = Number.isNaN(pieces) || pieces <= 0 ? 1 : pieces;
    return volume * safePieces;
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
    const total = (items || []).reduce((sum, item) => sum + calculatePackageItemVolumeTotal(item), 0);
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

function createEmptyBillingFeeItem(category = "") {
    return BILLING_FEE_FIELDS.reduce((item, field) => {
        item[field.key] = "";
        return item;
    }, { category });
}

function legacyNormalizeBillingFeeItems(items) {
    const sourceItems = Array.isArray(items) ? items : [];
    const itemMap = new Map(
        sourceItems.map(item => [String(item?.category || "").trim(), item || {}])
    );

    return BILLING_FEE_CATEGORIES.map(category => {
        const sourceItem = itemMap.get(category) || createEmptyBillingFeeItem(category);
        return BILLING_FEE_FIELDS.reduce((item, field) => {
            item[field.key] = sourceItem?.[field.key] ?? "";
            return item;
        }, { category });
    });
}

function legacyNormalizeBillingRecord(record = null) {
    return {
        serial_number: record?.serial_number || "",
        company_name: record?.company_name || "",
        orderer: record?.orderer || "",
        business_type: record?.business_type || "",
        sender_id: record?.sender_id || "",
        customer_id: record?.customer_id || "",
        receive_date: record?.receive_date || "",
        origin: record?.origin || "",
        destination: record?.destination || "",
        trade_term: record?.trade_term || "",
        product_name: record?.product_name || "",
        transport_mode: record?.transport_mode || "",
        tracking_number: record?.tracking_number || "",
        pieces_total: record?.pieces_total || "",
        weight_total: record?.weight_total || "",
        volume_total: record?.volume_total || "",
        charge_weight: record?.charge_weight || "",
        billing_completed_time: record?.billing_completed_time || "",
        cost_items: legacyNormalizeBillingFeeItems(record?.cost_items),
        billing_items: legacyNormalizeBillingFeeItems(record?.billing_items)
    };
}

function legacyBuildBillingBaseInfoItems(record) {
    return [
        ...buildCommonOrderFieldItems(record, record?.serial_number || ""),
        ["运输方式", record?.transport_mode || ""],
        ["运单号", record?.tracking_number || ""],
        ["件数", record?.pieces_total || ""],
        ["重量", record?.weight_total || ""],
        ["体积", record?.volume_total || ""],
        ["计费重量", record?.charge_weight || ""],
        ["账单完成时间", formatDateOnly(record?.billing_completed_time)]
    ];
}

function legacyBuildBillingFeeTableHtml(title, tableType, items, options = {}) {
    const { editable = false, collapsed = true, serialNumber = "" } = options;
    const sectionId = `${tableType}Section_${serialNumber || "general"}`;
    const bodyHtml = items.map((item, rowIndex) => `
        <tr>
            <td>${escapeHtml(item.category)}</td>
            ${BILLING_FEE_FIELDS.map((field) => {
                const value = item?.[field.key] ?? "";
                if (!editable) {
                    return `<td>${escapeHtml(value)}</td>`;
                }
                return `<td><input type="text" data-table-type="${tableType}" data-row-index="${rowIndex}" data-field="${field.key}" value="${escapeHtml(value)}"></td>`;
            }).join("")}
        </tr>
    `).join("");

    return `
        <div style="margin-top: 16px;">
            <button type="button" class="link-button" onclick="toggleBillingSection('${sectionId}')">${title}</button>
            <div id="${sectionId}" style="display:${collapsed ? "none" : "block"}; margin-top: 12px;">
                <table>
                    <thead>
                        <tr>
                            <th>费用类别</th>
                            ${BILLING_FEE_FIELDS.map(field => `<th>${field.label}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>${bodyHtml}</tbody>
                </table>
            </div>
        </div>
    `;
}

function toggleBillingSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) {
        return;
    }
    section.style.display = section.style.display === "none" ? "block" : "none";
}

function serializeBillingFeeItems(container, tableType) {
    const items = normalizeBillingFeeItems([]);
    container.querySelectorAll(`[data-table-type="${tableType}"]`).forEach((input) => {
        const rowIndex = Number.parseInt(input.dataset.rowIndex, 10);
        const field = input.dataset.field;
        if (!Number.isInteger(rowIndex) || !items[rowIndex] || !field) {
            return;
        }
        items[rowIndex][field] = input.value;
    });
    return items;
}

function ensureBillingPageStructure() {
    const billingPage = document.getElementById("billingPage");
    if (!billingPage) {
        return;
    }

    const section = billingPage.querySelector(".section");
    if (!section) {
        return;
    }

    if (!document.getElementById("billingTable")) {
        section.innerHTML = `
            <h2>账单信息维护</h2>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                <button type="button" onclick="loadBillingRecords()">加载账单信息</button>
            </div>
            <table id="billingTable">
                <thead>
                    <tr>
                        <th>流水号</th>
                        <th>公司名称</th>
                        <th>指令人</th>
                        <th>业务类型</th>
                        <th>发件人ID</th>
                        <th>收件人ID</th>
                        <th>接受指令日期</th>
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
                        <th>账单完成时间</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
            <div id="billingDetailContainer" style="margin-top: 24px;"></div>
        `;
    }
    syncBillingTableColumns();
}

function ensureOrderBillingSection() {
    const orderDetailPage = document.getElementById("orderDetailPage");
    if (!orderDetailPage || document.getElementById("orderBillingSection")) {
        return;
    }

    const customsSection = document.getElementById("orderCustomsClearanceSection");
    if (!customsSection || !customsSection.parentNode) {
        return;
    }

    const section = document.createElement("div");
    section.id = "orderBillingSection";
    section.style.marginTop = "24px";
    section.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0;">账单信息维护</h3>
            <button type="button" onclick="openBillingPageFromOrderDetail()">打开账单信息维护</button>
        </div>
        <div id="orderBillingContent"></div>
    `;

    customsSection.insertAdjacentElement("afterend", section);
}

function legacySummaryBuildBillingRecordRow(record) {
    const serialNumber = record.serial_number || "";
    return `
        <tr>
            <td><button class="link-button" onclick="showBillingDetail('${escapeHtml(serialNumber)}')">${escapeHtml(serialNumber)}</button></td>
            <td>${escapeHtml(record.company_name || "")}</td>
            <td>${escapeHtml(record.orderer || "")}</td>
            <td>${escapeHtml(record.business_type || "")}</td>
            <td>${escapeHtml(record.sender_id || "")}</td>
            <td>${escapeHtml(record.customer_id || "")}</td>
            <td>${escapeHtml(formatDateOnly(record.receive_date))}</td>
            <td>${escapeHtml(record.origin || "")}</td>
            <td>${escapeHtml(record.destination || "")}</td>
            <td>${escapeHtml(record.trade_term || "")}</td>
            <td>${escapeHtml(record.product_name || "")}</td>
            <td>${escapeHtml(record.transport_mode || "")}</td>
            <td>${escapeHtml(record.tracking_number || "")}</td>
            <td>${escapeHtml(record.pieces_total || "")}</td>
            <td>${escapeHtml(record.weight_total || "")}</td>
            <td>${escapeHtml(record.volume_total || "")}</td>
            <td>${escapeHtml(record.charge_weight || "")}</td>
            <td>${escapeHtml(formatDateOnly(record.billing_completed_time))}</td>
        </tr>
    `;
}

function legacyRenderBillingDetail(container, record, options = {}) {
    if (!container) {
        return;
    }

    const { editable = true, showSaveButton = true, collapsed = true, containerId = "" } = options;
    const normalized = normalizeBillingRecord(record);
    const baseItems = legacyBuildBillingBaseInfoItems(normalized);
    const detailKey = containerId || normalized.serial_number || "billing";

    container.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(baseItems)}</div>
        <div style="margin-top: 16px;">
            <div class="form-group">
                <label>账单完成时间:</label>
                ${editable
                    ? `<input type="date" id="billingCompletedTime_${detailKey}" value="${escapeHtml((normalized.billing_completed_time || "").split("T")[0])}">`
                    : `<span>${escapeHtml(formatDateOnly(normalized.billing_completed_time))}</span>`}
            </div>
        </div>
        ${legacyBuildBillingFeeTableHtml("成本信息", "cost_items", normalized.cost_items, {
            editable,
            collapsed,
            serialNumber: detailKey
        })}
        ${legacyBuildBillingFeeTableHtml("账单信息", "billing_items", normalized.billing_items, {
            editable,
            collapsed,
            serialNumber: detailKey
        })}
        ${showSaveButton ? `<div class="button-group"><button type="button" onclick="saveBillingRecord('${detailKey}')">保存账单信息</button></div>` : ""}
    `;

    container.dataset.serialNumber = normalized.serial_number || "";
    container.dataset.detailKey = detailKey;
    currentOrderBillingData = normalized;
}

async function loadBillingRecords() {
    ensureBillingPageStructure();
    try {
        const response = await fetch(`${API_BASE}/billing`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "加载账单信息失败");
        }

        const tbody = document.querySelector("#billingTable tbody");
        if (tbody) {
            tbody.innerHTML = (data.records || []).map(buildBillingRecordRow).join("");
            applyRenderedTablePagination("billingTable");
        }

        if (currentBillingSerialNumber) {
            await showBillingDetail(currentBillingSerialNumber);
        } else {
            const detailContainer = document.getElementById("billingDetailContainer");
            if (detailContainer) {
                detailContainer.innerHTML = "";
            }
        }
    } catch (error) {
        showMessage("加载账单信息失败: " + error.message, "error");
    }
}

async function fetchBillingRecordBySerial(serialNumber) {
    const response = await fetch(`${API_BASE}/billing/serial/${encodeURIComponent(serialNumber)}`);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || "加载账单详情失败");
    }
    return normalizeBillingRecord(data.record);
}

async function showBillingDetail(serialNumber) {
    currentBillingSerialNumber = serialNumber;
    const detailContainer = document.getElementById("billingDetailContainer");
    if (!detailContainer) {
        return;
    }

    try {
        const record = await fetchBillingRecordBySerial(serialNumber);
        renderBillingDetail(detailContainer, record, {
            editable: true,
            showSaveButton: true,
            collapsed: true,
            containerId: "billingPage"
        });
    } catch (error) {
        showMessage("加载账单详情失败: " + error.message, "error");
    }
}

async function loadOrderBillingDetails(serialNumber) {
    ensureOrderBillingSection();
    const container = document.getElementById("orderBillingContent");
    if (!container) {
        return;
    }

    if (!serialNumber) {
        container.innerHTML = "";
        currentOrderBillingData = null;
        return;
    }

    try {
        const record = await fetchBillingRecordBySerial(serialNumber);
        renderBillingDetail(container, record, {
            editable: true,
            showSaveButton: true,
            collapsed: true,
            containerId: "orderDetail"
        });
    } catch (error) {
        container.innerHTML = "";
        showMessage("加载账单详情失败: " + error.message, "error");
    }
}

async function legacySaveBillingRecord(detailKey) {
    const container = detailKey === "billingPage"
        ? document.getElementById("billingDetailContainer")
        : document.getElementById("orderBillingContent");

    if (!container) {
        return;
    }

    const serialNumber = container.dataset.serialNumber || currentOrderBillingData?.serial_number || currentBillingSerialNumber;
    if (!serialNumber) {
        showMessage("未找到账单流水号", "error");
        return;
    }

    const billingCompletedTimeInput = document.getElementById(`billingCompletedTime_${detailKey}`);
    const payload = {
        billing_completed_time: billingCompletedTimeInput ? billingCompletedTimeInput.value : null,
        cost_items: serializeBillingFeeItems(container, "cost_items"),
        billing_items: serializeBillingFeeItems(container, "billing_items")
    };

    try {
        const response = await fetch(`${API_BASE}/billing/serial/${encodeURIComponent(serialNumber)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "保存账单信息失败");
        }

        const record = normalizeBillingRecord(data.record);
        currentOrderBillingData = record;
        renderBillingDetail(container, record, {
            editable: true,
            showSaveButton: true,
            collapsed: false,
            containerId: detailKey
        });
        showMessage("账单信息保存成功");
        if (detailKey === "billingPage") {
            loadBillingRecords();
        }
        if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
            loadOrderBillingDetails(serialNumber);
        }
    } catch (error) {
        showMessage("保存账单信息失败: " + error.message, "error");
    }
}

function openBillingPageFromOrderDetail() {
    if (!currentOrderDetailSerial) {
        showMessage("未找到订单流水号", "error");
        return;
    }

    currentBillingSerialNumber = currentOrderDetailSerial;
    showPage("billing");
}

const BILLING_TEMPLATE_API = window.BillingTemplates || null;
const BILLING_FORMULA_API = window.BillingFormula || null;
const BILLING_TEMPLATE_FALLBACK_KEY = BILLING_TEMPLATE_API?.LEGACY_BILLING_TEMPLATE_KEY || "legacy";

function isBillingFormulaField(fieldKey) {
    return Boolean(BILLING_FORMULA_API?.isFormulaEnabledField?.(fieldKey));
}

function normalizeBillingComputedFieldValue(fieldKey, rawValue) {
    if (!BILLING_FORMULA_API?.normalizeBillingFieldValue) {
        return {
            ok: true,
            value: String(rawValue ?? "").trim(),
            raw: String(rawValue ?? "").trim(),
            kind: "text"
        };
    }

    return BILLING_FORMULA_API.normalizeBillingFieldValue(fieldKey, rawValue);
}

function normalizeBillingItemsForPersistence(items, templateKey = BILLING_TEMPLATE_FALLBACK_KEY) {
    const normalizedItems = Array.isArray(items) ? items : [];
    if (!BILLING_FORMULA_API?.normalizeBillingItems) {
        return normalizeBillingFeeItems(normalizedItems, templateKey);
    }

    return BILLING_FORMULA_API.normalizeBillingItems(
        normalizedItems,
        templateKey,
        (nextItems, nextTemplateKey) => normalizeBillingFeeItems(nextItems, nextTemplateKey)
    );
}

function getBillingFieldCalculationHint(fieldKey, rawValue) {
    const normalized = normalizeBillingComputedFieldValue(fieldKey, rawValue);
    if (!normalized.ok) {
        return {
            state: "error",
            message: "公式无效",
            normalized
        };
    }

    if (normalized.computed) {
        return {
            state: "computed",
            message: `=${normalized.value}`,
            normalized
        };
    }

    return {
        state: "idle",
        message: "",
        normalized
    };
}

function ensureBillingFormulaStyles() {
    if (document.getElementById("billingFormulaStyles")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "billingFormulaStyles";
    style.textContent = `
        .billing-formula-cell {
            position: relative;
            min-width: 120px;
        }
        .billing-formula-input {
            width: 100%;
        }
        .billing-formula-hint {
            display: block;
            margin-top: 4px;
            font-size: 12px;
            color: #6b7280;
            min-height: 16px;
            line-height: 1.2;
        }
        .billing-formula-hint.error {
            color: #dc2626;
        }
        .billing-formula-hint.computed {
            color: #2563eb;
        }
        .billing-formula-input.error {
            border-color: #dc2626;
            box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.12);
        }
    `;
    document.head.appendChild(style);
}

function buildBillingFieldInputHtml(tableType, rowIndex, field, value) {
    const escapedValue = escapeHtml(value);
    if (!isBillingFormulaField(field.key)) {
        return `<input type="text" data-table-type="${tableType}" data-row-index="${rowIndex}" data-field="${field.key}" value="${escapedValue}">`;
    }

    const hint = getBillingFieldCalculationHint(field.key, value);
    const hintClass = hint.state === "error" ? "billing-formula-hint error" : hint.state === "computed" ? "billing-formula-hint computed" : "billing-formula-hint";
    const inputClass = hint.state === "error" ? "billing-formula-input error" : "billing-formula-input";
    return `
        <div class="billing-formula-cell">
            <input
                type="text"
                class="${inputClass}"
                data-table-type="${tableType}"
                data-row-index="${rowIndex}"
                data-field="${field.key}"
                data-billing-formula-enabled="true"
                value="${escapedValue}"
            >
            <span class="${hintClass}" data-billing-formula-hint="${field.key}">${escapeHtml(hint.message)}</span>
        </div>
    `;
}

function updateBillingFormulaInputState(input) {
    if (!input || input.dataset.billingFormulaEnabled !== "true") {
        return true;
    }

    const fieldKey = input.dataset.field || "";
    const hint = input.parentElement?.querySelector(`[data-billing-formula-hint="${fieldKey}"]`);
    const result = getBillingFieldCalculationHint(fieldKey, input.value);

    input.classList.toggle("error", result.state === "error");
    if (hint) {
        hint.textContent = result.message;
        hint.className = result.state === "error"
            ? "billing-formula-hint error"
            : result.state === "computed"
                ? "billing-formula-hint computed"
                : "billing-formula-hint";
    }

    return result.state !== "error";
}

function commitBillingFormulaInputValue(input) {
    if (!input || input.dataset.billingFormulaEnabled !== "true") {
        return true;
    }

    const result = normalizeBillingComputedFieldValue(input.dataset.field || "", input.value);
    updateBillingFormulaInputState(input);
    if (!result.ok) {
        return false;
    }

    if (result.computed || result.kind === "numeric") {
        input.value = result.value;
        updateBillingFormulaInputState(input);
    }

    return true;
}

let billingFormulaEventsInstalled = false;

function getBillingFormulaInputFromEventTarget(target) {
    if (!(target instanceof Element)) {
        return null;
    }

    return target.matches('input[data-billing-formula-enabled="true"]')
        ? target
        : target.closest('input[data-billing-formula-enabled="true"]');
}

function installBillingFormulaEventDelegation() {
    if (billingFormulaEventsInstalled || typeof document === "undefined") {
        return;
    }

    document.addEventListener("input", (event) => {
        const input = getBillingFormulaInputFromEventTarget(event.target);
        if (input) {
            updateBillingFormulaInputState(input);
        }
    });

    document.addEventListener("focusout", (event) => {
        const input = getBillingFormulaInputFromEventTarget(event.target);
        if (input) {
            commitBillingFormulaInputValue(input);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
            return;
        }

        const input = getBillingFormulaInputFromEventTarget(event.target);
        if (input) {
            commitBillingFormulaInputValue(input);
        }
    });

    billingFormulaEventsInstalled = true;
}

function bindBillingFormulaInputs(container) {
    if (!container) {
        return;
    }

    ensureBillingFormulaStyles();
    installBillingFormulaEventDelegation();
    const inputs = container.querySelectorAll('input[data-billing-formula-enabled="true"]');
    inputs.forEach((input) => {
        updateBillingFormulaInputState(input);
    });
}

installBillingFormulaEventDelegation();

function validateBillingFormulaInputs(container) {
    if (!container) {
        return true;
    }

    const inputs = Array.from(container.querySelectorAll('input[data-billing-formula-enabled="true"]'));
    for (const input of inputs) {
        if (!commitBillingFormulaInputValue(input)) {
            input.focus();
            return false;
        }
    }

    return true;
}

function getBillingTemplateFieldDefinitions(templateKey = BILLING_TEMPLATE_FALLBACK_KEY) {
    if (!BILLING_TEMPLATE_API) {
        return BILLING_FEE_FIELDS;
    }

    return BILLING_TEMPLATE_API.getBillingFieldDefinitions(templateKey);
}

function getBillingTemplateContext(record = {}, forcedTemplateKey = "") {
    if (!BILLING_TEMPLATE_API) {
        return {
            key: BILLING_TEMPLATE_FALLBACK_KEY,
            template: {
                label: "历史通用",
                title: "历史通用账单格式",
                amountLabel: "金额"
            },
            source: "legacy_empty"
        };
    }

    return BILLING_TEMPLATE_API.resolveBillingTemplate(
        {
            ...record,
            cost_items: Array.isArray(record?.cost_items) ? record.cost_items : [],
            billing_items: Array.isArray(record?.billing_items) ? record.billing_items : []
        },
        forcedTemplateKey
            ? { forceTemplateKey: forcedTemplateKey }
            : { preferredTemplateKey: record?.billing_template_key || "" }
    );
}

function normalizeBillingFeeItems(items, templateKey = BILLING_TEMPLATE_FALLBACK_KEY) {
    if (!BILLING_TEMPLATE_API) {
        return Array.isArray(items) ? items : [];
    }

    return BILLING_TEMPLATE_API.normalizeBillingItems(items, templateKey, {
        preserveUnknown: templateKey === BILLING_TEMPLATE_FALLBACK_KEY
    });
}

function normalizeBillingRecord(record = null, forcedTemplateKey = "") {
    const templateContext = getBillingTemplateContext(record || {}, forcedTemplateKey);
    const templateKey = templateContext.key || BILLING_TEMPLATE_FALLBACK_KEY;

    return {
        serial_number: record?.serial_number || "",
        company_name: record?.company_name || "",
        orderer: record?.orderer || "",
        business_type: record?.business_type || "",
        sender_id: record?.sender_id || "",
        customer_id: record?.customer_id || "",
        receive_date: record?.receive_date || "",
        origin: record?.origin || "",
        destination: record?.destination || "",
        trade_term: record?.trade_term || "",
        product_name: record?.product_name || "",
        transport_mode: record?.transport_mode || "",
        tracking_number: record?.tracking_number || "",
        pieces_total: record?.pieces_total || "",
        weight_total: record?.weight_total || "",
        volume_total: record?.volume_total || "",
        charge_weight: record?.charge_weight || "",
        billing_completed_time: record?.billing_completed_time || "",
        billing_period: record?.billing_period || record?.billing_period_raw || "",
        billing_template_key: templateKey,
        billing_template_label: templateContext.template.label,
        billing_template_title: templateContext.template.title,
        billing_amount_label: templateContext.template.amountLabel,
        billing_template_source: templateContext.source,
        cost_items: normalizeBillingFeeItems(record?.cost_items, templateKey),
        billing_items: normalizeBillingFeeItems(record?.billing_items, templateKey)
    };
}

function legacyTemplateBuildBillingBaseInfoItems(record) {
    return [
        ...buildCommonOrderFieldItems(record, record?.serial_number || ""),
        ["运输方式", record?.transport_mode || ""],
        ["账单模板", record?.billing_template_title || record?.billing_template_label || ""],
        ["运单号", record?.tracking_number || ""],
        ["件数", record?.pieces_total || ""],
        ["重量", record?.weight_total || ""],
        ["体积", record?.volume_total || ""],
        ["计费重量", record?.charge_weight || ""],
        ["账单完成时间", formatDateOnly(record?.billing_completed_time)]
    ];
}

function buildBillingTemplateNotice(record) {
    if (!record) {
        return "";
    }

    if (record.billing_template_source === "transport_mode") {
        return "";
    }

    if (record.billing_template_source === "business_type") {
        return `
            <div class="info" style="margin-top: 16px;">
                当前运输方式未直接识别，已按业务类型切换到“${escapeHtml(record.billing_template_label || "")}”账单格式。
            </div>
        `;
    }

    if (record.billing_template_source === "items") {
        return `
            <div class="info" style="margin-top: 16px;">
                当前运输方式缺失或不明确，已根据历史账单内容识别为“${escapeHtml(record.billing_template_label || "")}”格式。
            </div>
        `;
    }

    return `
        <div class="info" style="margin-top: 16px;">
            当前记录未能安全识别到五类账单格式，已按历史通用格式兼容回显。请先核对运输方式，必要时选择正确模板后再保存。
        </div>
    `;
}

function buildBillingTemplateOptionsHtml(selectedKey) {
    if (!BILLING_TEMPLATE_API) {
        return `<option value="${BILLING_TEMPLATE_FALLBACK_KEY}">历史通用</option>`;
    }

    const templateKeys = [...BILLING_TEMPLATE_API.BILLING_TEMPLATE_ORDER];
    if (!templateKeys.includes(selectedKey) && selectedKey === BILLING_TEMPLATE_FALLBACK_KEY) {
        templateKeys.push(BILLING_TEMPLATE_FALLBACK_KEY);
    }

    return templateKeys.map((templateKey) => {
        const template = BILLING_TEMPLATE_API.getBillingTemplate(templateKey);
        const selected = templateKey === selectedKey ? "selected" : "";
        return `<option value="${escapeHtml(templateKey)}" ${selected}>${escapeHtml(template.label)}</option>`;
    }).join("");
}

function buildBillingFeeTableHtml(title, tableType, items, options = {}) {
    const {
        editable = false,
        collapsed = true,
        serialNumber = "",
        templateKey = BILLING_TEMPLATE_FALLBACK_KEY
    } = options;
    const sectionId = `${tableType}Section_${serialNumber || "general"}`;
    const fieldDefinitions = getBillingTemplateFieldDefinitions(templateKey);
    const bodyHtml = items.map((item, rowIndex) => `
        <tr data-billing-row="${tableType}" data-row-index="${rowIndex}" data-category="${escapeHtml(item.category || "")}">
            <td>${escapeHtml(item.category)}</td>
            ${fieldDefinitions.map((field) => {
                const value = item?.[field.key] ?? "";
                if (!editable) {
                    return `<td>${escapeHtml(value)}</td>`;
                }
                return `<td>${buildBillingFieldInputHtml(tableType, rowIndex, field, value)}</td>`;
            }).join("")}
        </tr>
    `).join("");

    return `
        <div style="margin-top: 16px;">
            <button type="button" class="link-button" onclick="toggleBillingSection('${sectionId}')">${title}</button>
            <div id="${sectionId}" style="display:${collapsed ? "none" : "block"}; margin-top: 12px;">
                <table>
                    <thead>
                        <tr>
                            <th>费用类别</th>
                            ${fieldDefinitions.map(field => `<th>${field.label}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>${bodyHtml}</tbody>
                </table>
            </div>
        </div>
    `;
}

function legacySerializeBillingFeeItems(container, tableType, templateKey = BILLING_TEMPLATE_FALLBACK_KEY) {
    const fieldDefinitions = getBillingTemplateFieldDefinitions(templateKey);
    const rows = Array.from(container.querySelectorAll(`[data-billing-row="${tableType}"]`));
    const items = rows.map((row) => {
        const item = { category: row.dataset.category || "" };

        fieldDefinitions.forEach((field) => {
            const input = row.querySelector(`[data-field="${field.key}"]`);
            item[field.key] = input ? input.value : "";
        });

        return item;
    });

    return normalizeBillingItemsForPersistence(items, templateKey);
}

function legacyGetBillingDetailContainer(detailKey) {
    return detailKey === "billingPage"
        ? document.getElementById("billingDetailContainer")
        : document.getElementById("orderBillingContent");
}

function legacySwitchBillingTemplate(detailKey) {
    const container = legacyGetBillingDetailContainer(detailKey);
    if (!container) {
        return;
    }

    const nextTemplateKey = document.getElementById(`billingTemplateKey_${detailKey}`)?.value || BILLING_TEMPLATE_FALLBACK_KEY;
    const currentTemplateKey = container.dataset.billingTemplateKey || BILLING_TEMPLATE_FALLBACK_KEY;
    const billingCompletedTimeInput = document.getElementById(`billingCompletedTime_${detailKey}`);
    let draftRecord = {};

    try {
        draftRecord = JSON.parse(container.dataset.billingRecordJson || "{}");
    } catch (error) {
        draftRecord = {};
    }

    draftRecord = {
        ...draftRecord,
        billing_completed_time: billingCompletedTimeInput ? billingCompletedTimeInput.value : (draftRecord.billing_completed_time || ""),
        cost_items: legacySerializeBillingFeeItems(container, "cost_items", currentTemplateKey),
        billing_items: legacySerializeBillingFeeItems(container, "billing_items", currentTemplateKey),
        billing_template_key: nextTemplateKey
    };

    let renderOptions = {};
    try {
        renderOptions = JSON.parse(container.dataset.renderOptions || "{}");
    } catch (error) {
        renderOptions = {};
    }

    renderBillingDetail(container, draftRecord, {
        ...renderOptions,
        containerId: detailKey,
        forcedTemplateKey: nextTemplateKey
    });
}

function legacyModalRenderBillingDetail(container, record, options = {}) {
    if (!container) {
        return;
    }

    const {
        editable = true,
        showSaveButton = true,
        collapsed = true,
        containerId = "",
        forcedTemplateKey = ""
    } = options;
    const normalized = normalizeBillingRecord(record, forcedTemplateKey);
    const detailKey = containerId || normalized.serial_number || "billing";
    const baseItems = buildBillingBaseInfoItems(normalized);
    const allowTemplateSwitch = editable && (
        normalized.billing_template_source === "legacy_fallback" ||
        normalized.billing_template_source === "legacy_items" ||
        normalized.billing_template_source === "legacy_empty"
    );

    container.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(baseItems)}</div>
        ${buildBillingTemplateNotice(normalized)}
        <div style="margin-top: 16px;">
            <div class="form-group">
                <label>账单模板:</label>
                ${allowTemplateSwitch
                    ? `<select id="billingTemplateKey_${detailKey}" onchange="switchBillingTemplate('${detailKey}')">${buildBillingTemplateOptionsHtml(normalized.billing_template_key)}</select>`
                    : `<input type="text" value="${escapeHtml(normalized.billing_template_title || normalized.billing_template_label || "")}" readonly>`}
            </div>
            <div class="form-group">
                <label>账单完成时间:</label>
                ${editable
                    ? `<input type="date" id="billingCompletedTime_${detailKey}" value="${escapeHtml((normalized.billing_completed_time || "").split("T")[0])}">`
                    : `<span>${escapeHtml(formatDateOnly(normalized.billing_completed_time))}</span>`}
            </div>
        </div>
        ${buildBillingFeeTableHtml(`成本信息（${normalized.billing_template_label || ""}）`, "cost_items", normalized.cost_items, {
            editable,
            collapsed,
            serialNumber: detailKey,
            templateKey: normalized.billing_template_key
        })}
        ${buildBillingFeeTableHtml(`账单信息（${normalized.billing_template_label || ""}）`, "billing_items", normalized.billing_items, {
            editable,
            collapsed,
            serialNumber: detailKey,
            templateKey: normalized.billing_template_key
        })}
        ${showSaveButton ? `<div class="button-group"><button type="button" onclick="saveBillingRecord('${detailKey}')">保存账单信息</button></div>` : ""}
    `;

    container.dataset.serialNumber = normalized.serial_number || "";
    container.dataset.detailKey = detailKey;
    container.dataset.billingTemplateKey = normalized.billing_template_key || BILLING_TEMPLATE_FALLBACK_KEY;
    container.dataset.billingRecordJson = JSON.stringify(normalized);
    container.dataset.renderOptions = JSON.stringify({
        editable,
        showSaveButton,
        collapsed,
        containerId: detailKey
    });
    currentOrderBillingData = normalized;
    bindBillingFormulaInputs(container);
}

async function legacyTemplateSaveBillingRecord(detailKey) {
    const container = getBillingDetailContainer(detailKey);
    if (!container) {
        return;
    }

    const serialNumber = container.dataset.serialNumber || currentOrderBillingData?.serial_number || currentBillingSerialNumber;
    if (!serialNumber) {
        showMessage("未找到账单流水号", "error");
        return;
    }

    const templateKey = container.dataset.billingTemplateKey || BILLING_TEMPLATE_FALLBACK_KEY;
    const billingCompletedTimeInput = document.getElementById(`billingCompletedTime_${detailKey}`);
    const payload = {
        billing_template_key: templateKey,
        billing_completed_time: billingCompletedTimeInput ? billingCompletedTimeInput.value : null,
        cost_items: serializeBillingFeeItems(container, "cost_items", templateKey),
        billing_items: serializeBillingFeeItems(container, "billing_items", templateKey)
    };

    try {
        const response = await fetch(`${API_BASE}/billing/serial/${encodeURIComponent(serialNumber)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "保存账单信息失败");
        }

        const nextRecord = normalizeBillingRecord(data.record);
        currentOrderBillingData = nextRecord;
        renderBillingDetail(container, nextRecord, {
            editable: true,
            showSaveButton: true,
            collapsed: false,
            containerId: detailKey
        });
        showMessage("账单信息保存成功");
        if (detailKey === "billingPage") {
            loadBillingRecords();
        }
        if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
            loadOrderBillingDetails(serialNumber);
        }
    } catch (error) {
        showMessage("保存账单信息失败: " + error.message, "error");
    }
}

function isBillingFeeItemFilled(item, templateKey = BILLING_TEMPLATE_FALLBACK_KEY) {
    const fieldDefinitions = getBillingTemplateFieldDefinitions(templateKey);
    return fieldDefinitions.some((field) => String(item?.[field.key] || "").trim() !== "");
}

function getBillingSectionMeta(tableType) {
    if (tableType === "cost_items") {
        return {
            title: "成本信息",
            editLabel: "编辑成本信息",
            emptyText: "当前未填写成本信息"
        };
    }

    return {
        title: "账单信息",
        editLabel: "编辑账单信息",
        emptyText: "当前未填写账单信息"
    };
}

function buildBillingFeeSectionCardHtml(tableType, items, options = {}) {
    const {
        editable = false,
        detailKey = "",
        templateKey = BILLING_TEMPLATE_FALLBACK_KEY
    } = options;
    const meta = getBillingSectionMeta(tableType);
    const normalizedItems = Array.isArray(items) ? items : [];
    const filledItems = normalizedItems.filter((item) => isBillingFeeItemFilled(item, templateKey));
    const previewCategories = filledItems.slice(0, 3).map((item) => escapeHtml(item.category || "")).join("、");
    const previewText = filledItems.length > 0
        ? `已填写 ${filledItems.length} / ${normalizedItems.length} 项${previewCategories ? `，包含：${previewCategories}${filledItems.length > 3 ? " 等" : ""}` : ""}`
        : meta.emptyText;

    return `
        <div style="margin-top: 16px; padding: 16px; background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                <div>
                    <h4 style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${meta.title}</h4>
                    <div class="info" style="margin-top: 8px;">${previewText}</div>
                </div>
                ${editable
                    ? `<button type="button" onclick="showBillingFeeModal('${escapeHtml(detailKey)}', '${tableType}')">${meta.editLabel}</button>`
                    : ""}
            </div>
        </div>
    `;
}

function buildBillingFeeEditorTableHtml(tableType, items, options = {}) {
    const {
        editable = false,
        templateKey = BILLING_TEMPLATE_FALLBACK_KEY
    } = options;
    const fieldDefinitions = getBillingTemplateFieldDefinitions(templateKey);
    const bodyHtml = (Array.isArray(items) ? items : []).map((item, rowIndex) => `
        <tr data-billing-row="${tableType}" data-row-index="${rowIndex}" data-category="${escapeHtml(item.category || "")}">
            <td>${escapeHtml(item.category)}</td>
            ${fieldDefinitions.map((field) => {
                const value = item?.[field.key] ?? "";
                if (!editable) {
                    return `<td>${escapeHtml(value)}</td>`;
                }
                return `<td>${buildBillingFieldInputHtml(tableType, rowIndex, field, value)}</td>`;
            }).join("")}
        </tr>
    `).join("");

    return `
        <div data-billing-modal-editor="true" style="margin-top: 16px; overflow-x: auto;">
            <table>
                <thead>
                    <tr>
                        <th>费用类别</th>
                        ${fieldDefinitions.map((field) => `<th>${field.label}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>${bodyHtml}</tbody>
            </table>
        </div>
    `;
}

function legacyTemplateSerializeBillingFeeItems(container, tableType, templateKey = BILLING_TEMPLATE_FALLBACK_KEY) {
    const fieldDefinitions = getBillingTemplateFieldDefinitions(templateKey);
    const rows = Array.from(container.querySelectorAll(`[data-billing-row="${tableType}"]`));
    const items = rows.map((row) => {
        const item = { category: row.dataset.category || "" };

        fieldDefinitions.forEach((field) => {
            const input = row.querySelector(`[data-field="${field.key}"]`);
            item[field.key] = input ? input.value : "";
        });

        return item;
    });

    return normalizeBillingItemsForPersistence(items, templateKey);
}

function getBillingDetailContainer(detailKey) {
    return detailKey === "billingPage"
        ? document.getElementById("billingDetailContainer")
        : document.getElementById("orderBillingContent");
}

function getBillingStoredRecord(container) {
    if (!container) {
        return {};
    }

    try {
        return JSON.parse(container.dataset.billingRecordJson || "{}");
    } catch (error) {
        return {};
    }
}

function getBillingRenderOptions(container, detailKey) {
    let renderOptions = {};

    if (container) {
        try {
            renderOptions = JSON.parse(container.dataset.renderOptions || "{}");
        } catch (error) {
            renderOptions = {};
        }
    }

    return {
        editable: renderOptions.editable !== false,
        showSaveButton: renderOptions.showSaveButton !== false,
        collapsed: renderOptions.collapsed === true,
        containerId: detailKey
    };
}

function buildBillingDraftRecord(detailKey) {
    const container = getBillingDetailContainer(detailKey);
    if (!container) {
        return null;
    }

    const storedRecord = getBillingStoredRecord(container);
    const selectedTemplateKey = document.getElementById(`billingTemplateKey_${detailKey}`)?.value
        || container.dataset.billingTemplateKey
        || storedRecord.billing_template_key
        || BILLING_TEMPLATE_FALLBACK_KEY;
    const billingCompletedTimeInput = document.getElementById(`billingCompletedTime_${detailKey}`);

    return normalizeBillingRecord(
        {
            ...storedRecord,
            billing_template_key: selectedTemplateKey,
            billing_completed_time: billingCompletedTimeInput
                ? billingCompletedTimeInput.value
                : (storedRecord.billing_completed_time || ""),
            cost_items: Array.isArray(storedRecord.cost_items) ? storedRecord.cost_items : [],
            billing_items: Array.isArray(storedRecord.billing_items) ? storedRecord.billing_items : []
        },
        selectedTemplateKey
    );
}

function getBillingModalRecordMeta(record) {
    return [
        ["流水号", record?.serial_number || ""],
        ["账单模板", record?.billing_template_title || record?.billing_template_label || ""],
        ["账单完成时间", formatDateOnly(record?.billing_completed_time)]
    ].filter(([, value]) => String(value || "").trim() !== "");
}

function hideBillingFeeModal() {
    const modal = document.getElementById("billingFeeModal");
    if (modal) {
        modal.remove();
    }
}

function showBillingFeeModal(detailKey, tableType) {
    const draftRecord = buildBillingDraftRecord(detailKey);
    if (!draftRecord) {
        showMessage("未找到账单编辑上下文", "error");
        return;
    }

    hideBillingFeeModal();

    const meta = getBillingSectionMeta(tableType);
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "billingFeeModal";
    modal.dataset.detailKey = detailKey;
    modal.dataset.tableType = tableType;
    modal.onclick = function(event) {
        if (event.target === modal) {
            hideBillingFeeModal();
        }
    };

    const modalMeta = getBillingModalRecordMeta(draftRecord);
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1120px; width: 96%;">
            <div class="modal-header">
                <h3>${meta.editLabel}</h3>
                <button class="modal-close" onclick="hideBillingFeeModal()">&times;</button>
            </div>
            ${modalMeta.length > 0 ? `<div class="detail-grid">${buildDetailGridItems(modalMeta)}</div>` : ""}
            ${buildBillingFeeEditorTableHtml(tableType, draftRecord[tableType], {
                editable: true,
                templateKey: draftRecord.billing_template_key
            })}
            <div class="button-group">
                <button type="button" onclick="saveBillingFeeModal()">保存</button>
                <button type="button" onclick="hideBillingFeeModal()">取消</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = "block";
    bindBillingFormulaInputs(modal);
}

async function persistBillingDraftRecord(detailKey, draftRecord) {
    const container = getBillingDetailContainer(detailKey);
    if (!container || !draftRecord) {
        return null;
    }

    if (!validateBillingFormulaInputs(container)) {
        showMessage("存在无效公式，请先修正后再保存", "error");
        return null;
    }

    const serialNumber = draftRecord.serial_number || container.dataset.serialNumber || currentOrderBillingData?.serial_number || currentBillingSerialNumber;
    if (!serialNumber) {
        showMessage("未找到账单流水号", "error");
        return null;
    }

    const templateKey = draftRecord.billing_template_key || BILLING_TEMPLATE_FALLBACK_KEY;
    const payload = {
        billing_template_key: templateKey,
        billing_completed_time: draftRecord.billing_completed_time || null,
        cost_items: normalizeBillingItemsForPersistence(draftRecord.cost_items, templateKey),
        billing_items: normalizeBillingItemsForPersistence(draftRecord.billing_items, templateKey)
    };

    try {
        const response = await fetch(`${API_BASE}/billing/serial/${encodeURIComponent(serialNumber)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "保存账单信息失败");
        }

        const nextRecord = normalizeBillingRecord(data.record);
        currentOrderBillingData = nextRecord;
        renderBillingDetail(container, nextRecord, getBillingRenderOptions(container, detailKey));
        showMessage("账单信息保存成功");

        if (detailKey === "billingPage") {
            loadBillingRecords();
        }
        if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
            loadOrderBillingDetails(serialNumber);
        }

        return nextRecord;
    } catch (error) {
        showMessage("保存账单信息失败: " + error.message, "error");
        return null;
    }
}

async function saveBillingFeeModal() {
    const modal = document.getElementById("billingFeeModal");
    if (!modal) {
        return;
    }

    const detailKey = modal.dataset.detailKey || "";
    const tableType = modal.dataset.tableType || "";
    if (!detailKey || !tableType) {
        hideBillingFeeModal();
        return;
    }

    if (!validateBillingFormulaInputs(modal)) {
        showMessage("存在无效公式，请先修正后再保存", "error");
        return;
    }

    const draftRecord = buildBillingDraftRecord(detailKey);
    if (!draftRecord) {
        return;
    }

    const editorContainer = modal.querySelector('[data-billing-modal-editor="true"]');
    const templateKey = draftRecord.billing_template_key || BILLING_TEMPLATE_FALLBACK_KEY;
    draftRecord[tableType] = serializeBillingFeeItems(editorContainer || modal, tableType, templateKey);

    const savedRecord = await persistBillingDraftRecord(detailKey, draftRecord);
    if (savedRecord) {
        hideBillingFeeModal();
    }
}

function switchBillingTemplate(detailKey) {
    const container = getBillingDetailContainer(detailKey);
    if (!container) {
        return;
    }

    const nextTemplateKey = document.getElementById(`billingTemplateKey_${detailKey}`)?.value || BILLING_TEMPLATE_FALLBACK_KEY;
    const draftRecord = buildBillingDraftRecord(detailKey);
    if (!draftRecord) {
        return;
    }

    renderBillingDetail(container, draftRecord, {
        ...getBillingRenderOptions(container, detailKey),
        containerId: detailKey,
        forcedTemplateKey: nextTemplateKey
    });
}

function legacyTemplateRenderBillingDetail(container, record, options = {}) {
    if (!container) {
        return;
    }

    const {
        editable = true,
        showSaveButton = true,
        collapsed = true,
        containerId = "",
        forcedTemplateKey = ""
    } = options;
    const normalized = normalizeBillingRecord(record, forcedTemplateKey);
    const detailKey = containerId || normalized.serial_number || "billing";
    const baseItems = buildBillingBaseInfoItems(normalized);
    const allowTemplateSwitch = editable && (
        normalized.billing_template_source === "legacy_fallback" ||
        normalized.billing_template_source === "legacy_items" ||
        normalized.billing_template_source === "legacy_empty"
    );

    container.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(baseItems)}</div>
        ${buildBillingTemplateNotice(normalized)}
        <div style="margin-top: 16px;">
            <div class="form-group">
                <label>账单模板:</label>
                ${allowTemplateSwitch
                    ? `<select id="billingTemplateKey_${detailKey}" onchange="switchBillingTemplate('${detailKey}')">${buildBillingTemplateOptionsHtml(normalized.billing_template_key)}</select>`
                    : `<input type="text" value="${escapeHtml(normalized.billing_template_title || normalized.billing_template_label || "")}" readonly>`}
            </div>
            <div class="form-group">
                <label>账单完成时间:</label>
                ${editable
                    ? `<input type="date" id="billingCompletedTime_${detailKey}" value="${escapeHtml((normalized.billing_completed_time || "").split("T")[0])}">`
                    : `<span>${escapeHtml(formatDateOnly(normalized.billing_completed_time))}</span>`}
            </div>
        </div>
        ${buildBillingFeeSectionCardHtml("cost_items", normalized.cost_items, {
            editable,
            detailKey,
            templateKey: normalized.billing_template_key
        })}
        ${buildBillingFeeSectionCardHtml("billing_items", normalized.billing_items, {
            editable,
            detailKey,
            templateKey: normalized.billing_template_key
        })}
        ${showSaveButton ? `<div class="button-group"><button type="button" onclick="saveBillingRecord('${detailKey}')">保存账单信息</button></div>` : ""}
    `;

    container.dataset.serialNumber = normalized.serial_number || "";
    container.dataset.detailKey = detailKey;
    container.dataset.billingTemplateKey = normalized.billing_template_key || BILLING_TEMPLATE_FALLBACK_KEY;
    container.dataset.billingRecordJson = JSON.stringify(normalized);
    container.dataset.renderOptions = JSON.stringify({
        editable,
        showSaveButton,
        collapsed,
        containerId: detailKey
    });
    currentOrderBillingData = normalized;
    bindBillingFormulaInputs(container);
}

async function saveBillingRecord(detailKey) {
    const draftRecord = buildBillingDraftRecord(detailKey);
    if (!draftRecord) {
        return;
    }

    await persistBillingDraftRecord(detailKey, draftRecord);
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

function getOrderRemarkValue(record, fieldName) {
    const aliasFieldName = fieldName === "remark1"
        ? "remark_1"
        : fieldName === "remark2"
            ? "remark_2"
            : fieldName;

    return record?.[fieldName] || record?.[aliasFieldName] || "";
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

function syncBillingTableColumns() {
    const headerRow = document.querySelector("#billingTable thead tr");
    if (!headerRow) {
        return;
    }

    headerRow.innerHTML = getOrderSummaryFieldDefinitions()
        .map((field) => `<th>${escapeHtml(field.label)}</th>`)
        .join("");
}

function buildBillingRecordRow(record) {
    const serialNumber = record?.serial_number || "";
    const cells = getOrderSummaryFieldDefinitions().map((field) => {
        const value = formatOrderSummaryFieldValue(
            field.key,
            getOrderSummaryFieldValue(record, field.key)
        );

        if (field.key === "serial_number") {
            return `<td><button class="link-button" onclick="showBillingDetail('${escapeHtml(serialNumber)}')">${escapeHtml(value)}</button></td>`;
        }

        return `<td>${escapeHtml(value)}</td>`;
    }).join("");

    return `<tr>${cells}</tr>`;
}

function buildBillingBaseInfoItems(record) {
    return buildOrderSummaryDetailItems(record, record?.serial_number || "");
}

function renderBillingDetail(container, record, options = {}) {
    if (!container) {
        return;
    }

    const {
        editable = true,
        containerId = "",
        forcedTemplateKey = ""
    } = options;
    const normalized = normalizeBillingRecord(record, forcedTemplateKey);
    const detailKey = containerId || normalized.serial_number || "billing";
    const baseItems = buildBillingBaseInfoItems(normalized);

    container.innerHTML = `
        <div class="detail-grid">${buildDetailGridItems(baseItems)}</div>
        ${editable ? `
            <div class="button-group">
                <button type="button" onclick="showBillingFeeModal('${escapeHtml(detailKey)}', 'cost_items')">\u7f16\u8f91\u6210\u672c\u660e\u7ec6</button>
                <button type="button" onclick="showBillingFeeModal('${escapeHtml(detailKey)}', 'billing_items')">\u7f16\u8f91\u9500\u552e\u660e\u7ec6</button>
            </div>
        ` : ""}
    `;

    container.dataset.serialNumber = normalized.serial_number || "";
    container.dataset.detailKey = detailKey;
    container.dataset.billingTemplateKey = normalized.billing_template_key || BILLING_TEMPLATE_FALLBACK_KEY;
    container.dataset.billingRecordJson = JSON.stringify(normalized);
    container.dataset.renderOptions = JSON.stringify({
        editable,
        showSaveButton: false,
        collapsed: true,
        containerId: detailKey
    });
    currentOrderBillingData = normalized;
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

async function refreshTrackingLinkedViews(serialNumber) {
    const refreshTasks = [
        loadPickupTrackings(),
        loadTransfers(),
        loadCustomsClearance(),
        loadPackages(),
        loadBillingRecords()
    ];

    if (currentOrderDetailSerial && currentOrderDetailSerial === serialNumber) {
        refreshTasks.push(
            loadOrderPackageDetails(serialNumber),
            loadOrderPickupTrackingDetails(serialNumber),
            loadOrderDeliveryTrackingDetails(serialNumber),
            loadOrderCustomsClearanceDetails(serialNumber),
            loadOrderBillingDetails(serialNumber)
        );
    }

    await Promise.allSettled(refreshTasks);
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
            form.querySelector("#orderRemark1").value = getOrderRemarkValue(order, "remark1");
            form.querySelector("#orderRemark2").value = getOrderRemarkValue(order, "remark2");
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

        if (typeof window.initializeOrderInputMemory === "function") {
            window.initializeOrderInputMemory(form);
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
    const companyNameElement = getOrderFormElement("companyName", form);
    const companyName = companyNameElement?.value.trim() || "";
    if (!companyName) {
        showMessage("公司抬头不能为空，请手动填写", "error");
        companyNameElement?.focus();
        return;
    }
    const orderData = {
        company_name: companyName,
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
            if (typeof window.recordOrderInputMemory === "function") {
                window.recordOrderInputMemory(orderData);
            }
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

async function deleteOrderFromManagement(id) {
    if (!isAdminUser()) {
        showMessage("仅管理员可执行删单", "error");
        return;
    }

    const dangerConfirm = confirm("危险操作：删除后将移除订单及其关联数据，且无法恢复。是否继续？");
    if (!dangerConfirm) {
        return;
    }

    const finalConfirm = confirm("请再次确认：仅在删单管理页面执行删除。确定删除该订单吗？");
    if (!finalConfirm) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/orders/delete-management/${id}`, {
            method: "DELETE",
            headers: getAuthHeaders({
                "x-order-delete-source": "delete-management"
            })
        });
        const result = await response.json();

        if (response.ok) {
            showMessage("订单删除成功");
            loadDeleteOrders();
        } else {
            showMessage("删除失败: " + (result.error || "未知错误"), "error");
        }
    } catch (error) {
        showMessage("删除失败: " + error.message, "error");
    }
}

function hideFilterForm() {
    document.getElementById("filterModal").style.display = "none";
}

function showFilterForm(pageName = activeOrderPageContext) {
    activeOrderPageContext = pageName;
    ensureOrderIndexStructure(pageName);
    document.getElementById("filterModal").style.display = "block";
}

function applyFilters(pageName = activeOrderPageContext) {
    const state = getOrderPageState(pageName);
    state.filters = {
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
        billing_completed_time_filled_status: getFilterInputValue("filterBillingCompletedTimeFilledStatus"),
        dateFilledStatus: document.getElementById("filterDateFilledStatus")?.value || "all"
    };

    Object.keys(state.filters).forEach((key) => {
        if (state.filters[key] === "" || state.filters[key] === "all") {
            delete state.filters[key];
        }
    });

    loadAndFilterOrders(pageName);
    hideFilterForm();
}

function clearFilters(pageName = activeOrderPageContext) {
    const state = getOrderPageState(pageName);
    document.getElementById("filterFormData")?.reset();
    const dateFilledStatus = document.getElementById("filterDateFilledStatus");
    if (dateFilledStatus) {
        dateFilledStatus.value = "all";
    }
    state.filters = {};
    state.searchTerm = "";

    const searchInput = document.getElementById(state.searchInputId);
    if (searchInput) {
        searchInput.value = "";
    }

    loadOrders(pageName);
    hideFilterForm();
}

function searchOrders() {
    const state = getOrderPageState(ORDER_PAGE_VIEW);
    state.searchTerm = document.getElementById(state.searchInputId)?.value.trim() || "";
    loadAndFilterOrders(ORDER_PAGE_VIEW);
}

function searchDeleteOrders() {
    const state = getOrderPageState(ORDER_PAGE_DELETE);
    state.searchTerm = document.getElementById(state.searchInputId)?.value.trim() || "";
    loadAndFilterOrders(ORDER_PAGE_DELETE);
}

function buildOrderFilterQuery(pageName = activeOrderPageContext) {
    const params = new URLSearchParams();
    const state = getOrderPageState(pageName);

    Object.entries(state.filters || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            params.set(key, value);
        }
    });

    return params.toString();
}

async function loadAndFilterOrders(pageName = activeOrderPageContext) {
    try {
        activeOrderPageContext = pageName;
        ensureOrderIndexStructure(pageName);
        const query = buildOrderFilterQuery(pageName);
        const response = await fetch(query ? `${API_BASE}/orders?${query}` : `${API_BASE}/orders`);
        const data = await response.json();
        const state = getOrderPageState(pageName);

        let filteredOrders = data.orders || [];
        if (state.searchTerm) {
            const searchLower = state.searchTerm.toLowerCase();
            filteredOrders = filteredOrders.filter((order) => {
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
                    order.product_name,
                    order.billing_completed_time,
                    order.billing_period
                ].some((value) => value && String(value).toLowerCase().includes(searchLower));
            });
        }

        displayOrders(filteredOrders, pageName);
    } catch (error) {
        showMessage("加载订单失败: " + error.message, "error");
    }
}

async function loadDeleteOrders() {
    if (!isAdminUser()) {
        showMessage("仅管理员可进入删单管理", "error");
        showPage("viewOrders");
        return;
    }
    await loadOrders(ORDER_PAGE_DELETE);
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
    applyRenderedTablePagination("usersTable");
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

function ensurePackagePaginationContainer() {
    const table = document.getElementById("packagesTable");
    if (!table || document.getElementById("packagesPagination")) {
        return;
    }

    const pagination = document.createElement("div");
    pagination.id = "packagesPagination";
    pagination.style.cssText = "display: none; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 16px;";
    table.insertAdjacentElement("afterend", pagination);
}

function renderPackagePagination(totalCount) {
    const pagination = document.getElementById("packagesPagination");
    if (!pagination) {
        return;
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / PACKAGE_PAGE_SIZE));
    pagination.style.display = "flex";
    pagination.innerHTML = `
        <span>共 ${totalCount} 条，第 ${currentPackagePage} / ${totalPages} 页</span>
        <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" onclick="changePackagePage(${currentPackagePage - 1})" ${currentPackagePage <= 1 ? "disabled" : ""}>上一页</button>
            <button type="button" onclick="changePackagePage(${currentPackagePage + 1})" ${currentPackagePage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
    `;
}

function changePackagePage(page) {
    const totalPages = Math.max(1, Math.ceil(currentPackageDisplayGroups.length / PACKAGE_PAGE_SIZE));
    const nextPage = Number(page);
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages) {
        return;
    }

    currentPackagePage = nextPage;
    displayPackages(currentPackageDisplayGroups);
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
        <div id="packagesPagination" style="display: none; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 16px;"></div>
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
    ensurePackagePaginationContainer();
    const tbody = document.querySelector("#packagesTable tbody");
    if (!tbody) {
        return;
    }

    const groupedPackages = Array.isArray(packages?.[0]?.packages) ? packages : groupPackagesBySerial(packages || []);
    currentPackageDisplayGroups = groupedPackages;
    const totalPages = Math.max(1, Math.ceil(groupedPackages.length / PACKAGE_PAGE_SIZE));
    if (currentPackagePage > totalPages) {
        currentPackagePage = totalPages;
    }
    const pageStart = (currentPackagePage - 1) * PACKAGE_PAGE_SIZE;
    const visibleGroups = groupedPackages.slice(pageStart, pageStart + PACKAGE_PAGE_SIZE);
    tbody.innerHTML = "";

    visibleGroups.forEach(group => {
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
    renderPackagePagination(groupedPackages.length);
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
    currentPackagePage = 1;
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
    applyRenderedTablePagination("packagingDbTable");
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
        const serialNumber = String(item.serial_number || "").trim();
        row.innerHTML = `
            <td>${escapeHtml(serialNumber)}</td>
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
    applyRenderedTablePagination("pickupTrackingsTable");
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
    if (typeof window.initializePickupTrackingInputMemory === "function") {
        window.initializePickupTrackingInputMemory(form);
    }

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
            if (typeof window.recordPickupTrackingInputMemory === "function") {
                window.recordPickupTrackingInputMemory(payload);
            }
            showMessage("提货运输跟踪保存成功");
            hidePickupTrackingForm();
            await refreshTrackingLinkedViews(serialNumber);
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
        const serialNumber = String(transfer.serial_number || "").trim();

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
            <td>${escapeHtml(serialNumber)}</td>
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
                <button onclick="editTransfer('${escapeHtml(serialNumber)}')">编辑</button>
            </td>
        `;
    });
    applyRenderedTablePagination("transfersTable");
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
                <div class="form-group">
                    <label>\u589e\u503c\u670d\u52a1\u5907\u6ce8:</label>
                    <textarea id="transferValueAddedServices"></textarea>
                </div>
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
            await refreshTrackingLinkedViews(serialNumber);
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
    applyRenderedTablePagination("guestsTable");
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
    applyRenderedTablePagination("productsTable");
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
    applyRenderedTablePagination("sendersTable");
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
    applyRenderedTablePagination("customersTable");
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
        activeOrderPageContext = ORDER_PAGE_VIEW;
        loadOrders(ORDER_PAGE_VIEW);
    } else if (pageName === "deleteOrders") {
        if (!isAdminUser()) {
            showMessage("仅管理员可进入删单管理", "error");
            document.getElementById("viewOrdersPage").style.display = "block";
            document.getElementById("viewOrdersLink").classList.add("active");
            activeOrderPageContext = ORDER_PAGE_VIEW;
            loadOrders(ORDER_PAGE_VIEW);
            return;
        }
        document.getElementById("deleteOrdersPage").style.display = "block";
        document.getElementById("deleteOrdersLink").classList.add("active");
        activeOrderPageContext = ORDER_PAGE_DELETE;
        loadDeleteOrders();
    } else if (pageName === "reportManagement") {
        if (!isAdminUser()) {
            showMessage("仅管理员可进入报表管理", "error");
            document.getElementById("viewOrdersPage").style.display = "block";
            document.getElementById("viewOrdersLink").classList.add("active");
            activeOrderPageContext = ORDER_PAGE_VIEW;
            loadOrders(ORDER_PAGE_VIEW);
            return;
        }
        document.getElementById("reportManagementPage").style.display = "block";
        document.getElementById("reportManagementLink").classList.add("active");
        showReportManagementMessage("请选择流水号和报表类型后查询", "info");
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
        ensureBillingPageStructure();
        loadBillingRecords();
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
    ensureBillingPageStructure();
    ensureOrderBillingSection();
    updateAllBatchDateControlsVisibility();
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

    const deleteOrdersSearchInput = document.getElementById("deleteOrdersSearchInput");
    if (deleteOrdersSearchInput) {
        deleteOrdersSearchInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                searchDeleteOrders();
            }
        });
    }

    const reportSerialInput = document.getElementById("reportSerialInput");
    if (reportSerialInput) {
        reportSerialInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                queryReports();
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
        const serialNumber = String(record.serial_number || "").trim();

        row.innerHTML = `
            <td>${escapeHtml(serialNumber)}</td>
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
    applyRenderedTablePagination("customsTable");
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
                    <label>运输方式:</label>
                    <input type="text" id="customsTransportMode">
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
    if (typeof window.initializeCustomsInputMemory === "function") {
        window.initializeCustomsInputMemory(form);
    }

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
            if (typeof window.recordCustomsInputMemory === "function") {
                window.recordCustomsInputMemory(recordData);
            }
            showMessage("报关信息保存成功");
            hideCustomsForm();
            await refreshTrackingLinkedViews(serialNumber);
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
