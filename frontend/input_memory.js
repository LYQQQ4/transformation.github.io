(function () {
    const INPUT_MEMORY_SCOPE = "order-form";
    const SESSION_STORAGE_KEY = "input-memory:order-form:v2";
    const MAX_SUGGESTIONS = 8;
    const MAX_SESSION_ITEMS_PER_FIELD = 40;
    const INPUT_UPDATE_DELAY_MS = 60;
    const MIN_FUZZY_QUERY_LENGTH = 2;
    const DAY_IN_MS = 24 * 60 * 60 * 1000;
    const FIELD_CONFIGS = [
        { fieldKey: "company_name", inputId: "companyName", maxLength: 80, persistSession: true },
        { fieldKey: "orderer", inputId: "orderer", maxLength: 50, persistSession: false },
        { fieldKey: "business_type", inputId: "businessType", maxLength: 40, persistSession: true },
        { fieldKey: "origin", inputId: "origin", maxLength: 40, persistSession: true },
        { fieldKey: "destination", inputId: "destination", maxLength: 40, persistSession: true },
        { fieldKey: "trade_term", inputId: "tradeTerm", maxLength: 20, persistSession: true },
        { fieldKey: "product_name", inputId: "productName", maxLength: 120, persistSession: true }
    ];

    const fieldConfigMap = FIELD_CONFIGS.reduce((accumulator, field) => {
        accumulator[field.fieldKey] = field;
        return accumulator;
    }, {});

    const volatileMemoryStore = {};
    const inputStates = new WeakMap();
    let sessionMemoryStore = readSessionStore();
    let remoteSuggestionsCache = null;
    let remoteSuggestionsPromise = null;
    let stylesInjected = false;

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeValue(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim();
    }

    function normalizeFieldValue(fieldKey, value) {
        const normalized = normalizeValue(value);
        if (!normalized) {
            return "";
        }

        if (fieldKey === "trade_term") {
            return normalized.toUpperCase();
        }

        return normalized;
    }

    function normalizeComparable(value) {
        return normalizeValue(value).toLocaleLowerCase();
    }

    function normalizeTimestamp(value) {
        if (!value) {
            return null;
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return null;
        }

        return date.toISOString();
    }

    function readSessionStore() {
        try {
            const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeSessionStore() {
        try {
            window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionMemoryStore));
        } catch {
            // Ignore storage failures.
        }
    }

    function getFieldStorageBucket(store, fieldKey) {
        if (!store[fieldKey] || typeof store[fieldKey] !== "object") {
            store[fieldKey] = {};
        }
        return store[fieldKey];
    }

    function isLikelySensitiveValue(value) {
        if (!value) {
            return true;
        }

        if (/@/.test(value)) {
            return true;
        }

        return value.replace(/\D/g, "").length >= 7;
    }

    function shouldTrackFieldValue(fieldKey, rawValue) {
        const config = fieldConfigMap[fieldKey];
        if (!config) {
            return false;
        }

        const value = normalizeFieldValue(fieldKey, rawValue);
        if (!value || value.length < 2 || value.length > config.maxLength) {
            return false;
        }

        if (/^[0-9\W_]+$/.test(value)) {
            return false;
        }

        return !isLikelySensitiveValue(value);
    }

    function trimStoreBucket(bucket) {
        return Object.entries(bucket)
            .sort((left, right) => {
                const frequencyGap = Number(right[1]?.frequency || 0) - Number(left[1]?.frequency || 0);
                if (frequencyGap !== 0) {
                    return frequencyGap;
                }

                const rightTime = right[1]?.last_used_at ? new Date(right[1].last_used_at).getTime() : 0;
                const leftTime = left[1]?.last_used_at ? new Date(left[1].last_used_at).getTime() : 0;
                return rightTime - leftTime;
            })
            .slice(0, MAX_SESSION_ITEMS_PER_FIELD)
            .reduce((accumulator, [entryKey, entryValue]) => {
                accumulator[entryKey] = entryValue;
                return accumulator;
            }, {});
    }

    function upsertMemory(store, fieldKey, rawValue) {
        const value = normalizeFieldValue(fieldKey, rawValue);
        const key = value.toLocaleLowerCase();
        const bucket = getFieldStorageBucket(store, fieldKey);
        const current = bucket[key] || { value, frequency: 0, last_used_at: null };
        current.value = value;
        current.frequency = Number(current.frequency || 0) + 1;
        current.last_used_at = new Date().toISOString();
        bucket[key] = current;
    }

    function upsertSessionMemory(fieldKey, rawValue) {
        const config = fieldConfigMap[fieldKey];
        if (!config || !config.persistSession || !shouldTrackFieldValue(fieldKey, rawValue)) {
            return;
        }

        upsertMemory(sessionMemoryStore, fieldKey, rawValue);
        sessionMemoryStore[fieldKey] = trimStoreBucket(sessionMemoryStore[fieldKey]);
        writeSessionStore();
    }

    function upsertVolatileMemory(fieldKey, rawValue) {
        if (!shouldTrackFieldValue(fieldKey, rawValue)) {
            return;
        }

        upsertMemory(volatileMemoryStore, fieldKey, rawValue);
    }

    function getStoredSuggestions(store, fieldKey, sourceName) {
        const bucket = store[fieldKey];
        if (!bucket || typeof bucket !== "object") {
            return [];
        }

        return Object.values(bucket)
            .map((item) => ({
                value: normalizeFieldValue(fieldKey, item.value),
                frequency: Number(item.frequency || 0),
                last_used_at: item.last_used_at || null,
                source: sourceName
            }))
            .filter((item) => item.value);
    }

    function mergeSuggestions(fieldKey, localItems, remoteItems) {
        const merged = new Map();

        const mergeItem = (item, source) => {
            const value = normalizeFieldValue(fieldKey, item?.value);
            if (!value) {
                return;
            }

            const key = value.toLocaleLowerCase();
            const current = merged.get(key) || {
                value,
                frequency: 0,
                last_used_at: null,
                sources: []
            };

            current.frequency += Number(item?.frequency || 0);
            const nextTime = normalizeTimestamp(item?.last_used_at);
            if (nextTime) {
                const currentTime = current.last_used_at ? new Date(current.last_used_at).getTime() : 0;
                const nextTimestamp = new Date(nextTime).getTime();
                if (nextTimestamp > currentTime) {
                    current.last_used_at = nextTime;
                }
            }

            if (!current.sources.includes(source)) {
                current.sources.push(source);
            }

            merged.set(key, current);
        };

        localItems.forEach((item) => mergeItem(item, item.source || "local"));
        remoteItems.forEach((item) => mergeItem(item, "remote"));

        return Array.from(merged.values());
    }

    function calculateRecencyScore(lastUsedAt) {
        if (!lastUsedAt) {
            return 0;
        }

        const timestamp = new Date(lastUsedAt).getTime();
        if (!timestamp) {
            return 0;
        }

        const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / DAY_IN_MS));
        return Math.max(0, 60 - ageDays * 4);
    }

    function calculateSequentialMatchScore(query, candidate) {
        if (!query) {
            return 0;
        }

        let searchIndex = 0;
        let hitCount = 0;
        for (const char of query) {
            const nextIndex = candidate.indexOf(char, searchIndex);
            if (nextIndex === -1) {
                return -1;
            }
            hitCount += 1;
            searchIndex = nextIndex + 1;
        }

        return hitCount * 12;
    }

    function levenshteinDistance(left, right, maxDistance) {
        if (left === right) {
            return 0;
        }

        const leftLength = left.length;
        const rightLength = right.length;
        if (!leftLength) {
            return rightLength;
        }
        if (!rightLength) {
            return leftLength;
        }
        if (Math.abs(leftLength - rightLength) > maxDistance) {
            return maxDistance + 1;
        }

        const previous = new Array(rightLength + 1);
        const current = new Array(rightLength + 1);

        for (let column = 0; column <= rightLength; column += 1) {
            previous[column] = column;
        }

        for (let row = 1; row <= leftLength; row += 1) {
            current[0] = row;
            let rowMin = current[0];

            for (let column = 1; column <= rightLength; column += 1) {
                const cost = left[row - 1] === right[column - 1] ? 0 : 1;
                current[column] = Math.min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + cost
                );
                rowMin = Math.min(rowMin, current[column]);
            }

            if (rowMin > maxDistance) {
                return maxDistance + 1;
            }

            for (let column = 0; column <= rightLength; column += 1) {
                previous[column] = current[column];
            }
        }

        return previous[rightLength];
    }

    function getWordPrefixScore(query, candidate) {
        if (!query) {
            return 0;
        }

        const parts = candidate.split(/[\s/-]+/).filter(Boolean);
        return parts.some((part) => part.startsWith(query)) ? 760 : 0;
    }

    function calculateSuggestionScore(query, suggestion) {
        const normalizedQuery = normalizeComparable(query);
        const normalizedValue = normalizeComparable(suggestion.value);

        if (!normalizedValue) {
            return -1;
        }

        let matchScore = 0;
        if (!normalizedQuery) {
            matchScore = 100;
        } else if (normalizedValue === normalizedQuery) {
            matchScore = 1500;
        } else if (normalizedValue.startsWith(normalizedQuery)) {
            matchScore = 1200 - Math.min(normalizedValue.length - normalizedQuery.length, 120);
        } else {
            matchScore = getWordPrefixScore(normalizedQuery, normalizedValue);

            if (!matchScore && normalizedValue.includes(normalizedQuery)) {
                matchScore = 720;
            }

            if (!matchScore && normalizedQuery.length >= MIN_FUZZY_QUERY_LENGTH) {
                const sequentialScore = calculateSequentialMatchScore(normalizedQuery, normalizedValue);
                if (sequentialScore > 0) {
                    matchScore = 460 + sequentialScore;
                }
            }

            if (!matchScore && normalizedQuery.length >= MIN_FUZZY_QUERY_LENGTH) {
                const candidateSlice = normalizedValue.slice(0, Math.min(normalizedValue.length, normalizedQuery.length + 2));
                const distance = levenshteinDistance(normalizedQuery, candidateSlice, 2);
                if (distance <= 2) {
                    matchScore = distance === 1 ? 540 : 500;
                }
            }

            if (!matchScore) {
                return -1;
            }
        }

        const frequencyScore = Math.min(Number(suggestion.frequency || 0), 50) * 10;
        const recencyScore = calculateRecencyScore(suggestion.last_used_at);
        const recentSourceBoost = suggestion.sources?.includes("session") || suggestion.sources?.includes("volatile") ? 30 : 0;
        return matchScore + frequencyScore + recencyScore + recentSourceBoost;
    }

    function getMergedFieldSuggestions(fieldKey) {
        const volatileItems = getStoredSuggestions(volatileMemoryStore, fieldKey, "volatile");
        const sessionItems = getStoredSuggestions(sessionMemoryStore, fieldKey, "session");
        const remoteItems = Array.isArray(remoteSuggestionsCache?.[fieldKey]) ? remoteSuggestionsCache[fieldKey] : [];
        return mergeSuggestions(fieldKey, [...volatileItems, ...sessionItems], remoteItems);
    }

    function getRankedSuggestions(fieldKey, query) {
        return getMergedFieldSuggestions(fieldKey)
            .map((item) => ({
                ...item,
                score: calculateSuggestionScore(query, item)
            }))
            .filter((item) => item.score >= 0)
            .sort((left, right) => {
                const scoreGap = right.score - left.score;
                if (scoreGap !== 0) {
                    return scoreGap;
                }

                const frequencyGap = (right.frequency || 0) - (left.frequency || 0);
                if (frequencyGap !== 0) {
                    return frequencyGap;
                }

                const rightTime = right.last_used_at ? new Date(right.last_used_at).getTime() : 0;
                const leftTime = left.last_used_at ? new Date(left.last_used_at).getTime() : 0;
                if (rightTime !== leftTime) {
                    return rightTime - leftTime;
                }

                return String(left.value).localeCompare(String(right.value), "zh-CN");
            })
            .slice(0, MAX_SUGGESTIONS);
    }

    function getFallbackSuggestions(fieldKey) {
        return getMergedFieldSuggestions(fieldKey)
            .sort((left, right) => {
                const frequencyGap = (right.frequency || 0) - (left.frequency || 0);
                if (frequencyGap !== 0) {
                    return frequencyGap;
                }

                const rightTime = right.last_used_at ? new Date(right.last_used_at).getTime() : 0;
                const leftTime = left.last_used_at ? new Date(left.last_used_at).getTime() : 0;
                return rightTime - leftTime;
            })
            .slice(0, 5);
    }

    async function loadRemoteSuggestions() {
        if (remoteSuggestionsCache) {
            return remoteSuggestionsCache;
        }

        if (!remoteSuggestionsPromise) {
            remoteSuggestionsPromise = fetch(`${window.API_BASE}/input-memory/suggestions?scope=${encodeURIComponent(INPUT_MEMORY_SCOPE)}`)
                .then(async (response) => {
                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(data.error || "Failed to load input memory suggestions");
                    }
                    remoteSuggestionsCache = data.fields || {};
                    return remoteSuggestionsCache;
                })
                .catch((error) => {
                    console.warn("Failed to load input memory suggestions:", error);
                    remoteSuggestionsCache = remoteSuggestionsCache || {};
                    return remoteSuggestionsCache;
                })
                .finally(() => {
                    remoteSuggestionsPromise = null;
                });
        }

        return remoteSuggestionsPromise;
    }

    function ensureStyles() {
        if (stylesInjected) {
            return;
        }

        const style = document.createElement("style");
        style.textContent = `
            .input-memory-panel {
                position: absolute;
                z-index: 3000;
                min-width: 180px;
                max-width: 420px;
                max-height: 280px;
                overflow-y: auto;
                background: #ffffff;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
                padding: 6px;
            }
            .input-memory-panel[hidden] {
                display: none;
            }
            .input-memory-option {
                display: block;
                width: 100%;
                border: 0;
                background: transparent;
                text-align: left;
                padding: 8px 10px;
                border-radius: 6px;
                cursor: pointer;
                color: #111827;
                font-size: 13px;
                line-height: 1.35;
            }
            .input-memory-option:hover,
            .input-memory-option.active {
                background: #eef2ff;
            }
            .input-memory-option-title {
                display: block;
                font-weight: 600;
            }
            .input-memory-option-meta {
                display: block;
                margin-top: 2px;
                color: #6b7280;
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
        stylesInjected = true;
    }

    function createState(input, fieldKey) {
        ensureStyles();

        const panel = document.createElement("div");
        panel.className = "input-memory-panel";
        panel.hidden = true;
        panel.setAttribute("role", "listbox");
        document.body.appendChild(panel);

        const state = {
            input,
            fieldKey,
            panel,
            suggestions: [],
            activeIndex: -1,
            renderTimer: null,
            blurTimer: null
        };

        inputStates.set(input, state);
        return state;
    }

    function getState(input, fieldKey) {
        return inputStates.get(input) || createState(input, fieldKey);
    }

    function positionPanel(state) {
        if (state.panel.hidden) {
            return;
        }

        const rect = state.input.getBoundingClientRect();
        state.panel.style.left = `${window.scrollX + rect.left}px`;
        state.panel.style.top = `${window.scrollY + rect.bottom + 4}px`;
        state.panel.style.width = `${rect.width}px`;
    }

    function hidePanel(state) {
        state.activeIndex = -1;
        state.panel.hidden = true;
    }

    function showPanel(state) {
        if (!state.suggestions.length) {
            hidePanel(state);
            return;
        }

        state.panel.hidden = false;
        positionPanel(state);
    }

    function buildMetaLabel(item) {
        const parts = [];
        if (item.frequency) {
            parts.push(`used ${item.frequency}x`);
        }
        if (item.sources?.includes("session") || item.sources?.includes("volatile")) {
            parts.push("recent");
        }
        return parts.join(" / ");
    }

    function renderPanel(state) {
        if (!state.suggestions.length) {
            state.panel.innerHTML = "";
            hidePanel(state);
            return;
        }

        state.panel.innerHTML = state.suggestions.map((item, index) => {
            const meta = buildMetaLabel(item);
            return `
                <button
                    type="button"
                    class="input-memory-option${index === state.activeIndex ? " active" : ""}"
                    data-index="${index}"
                    role="option"
                    aria-selected="${index === state.activeIndex ? "true" : "false"}"
                >
                    <span class="input-memory-option-title">${escapeHtml(item.value)}</span>
                    ${meta ? `<span class="input-memory-option-meta">${escapeHtml(meta)}</span>` : ""}
                </button>
            `;
        }).join("");

        showPanel(state);
    }

    function applySuggestion(state, suggestion) {
        if (!suggestion) {
            return;
        }

        state.input.value = suggestion.value;
        hidePanel(state);
        state.input.dispatchEvent(new Event("input", { bubbles: true }));
        state.input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function updateSuggestions(state) {
        const query = normalizeValue(state.input.value);

        if (!query) {
            state.suggestions = getFallbackSuggestions(state.fieldKey);
            state.activeIndex = state.suggestions.length ? 0 : -1;
            renderPanel(state);
            return;
        }

        if (query.length === 1) {
            state.suggestions = getRankedSuggestions(state.fieldKey, query)
                .filter((item) => normalizeComparable(item.value).startsWith(normalizeComparable(query)));
        } else {
            state.suggestions = getRankedSuggestions(state.fieldKey, query);
        }

        state.activeIndex = state.suggestions.length ? 0 : -1;
        renderPanel(state);
    }

    function scheduleUpdate(state) {
        window.clearTimeout(state.renderTimer);
        state.renderTimer = window.setTimeout(() => updateSuggestions(state), INPUT_UPDATE_DELAY_MS);
    }

    function moveSelection(state, direction) {
        if (!state.suggestions.length) {
            return;
        }

        if (state.panel.hidden) {
            showPanel(state);
        }

        const nextIndex = state.activeIndex < 0
            ? 0
            : (state.activeIndex + direction + state.suggestions.length) % state.suggestions.length;
        state.activeIndex = nextIndex;
        renderPanel(state);

        const activeButton = state.panel.querySelector(`[data-index="${nextIndex}"]`);
        if (activeButton) {
            activeButton.scrollIntoView({ block: "nearest" });
        }
    }

    function bindInputMemory(input, fieldKey) {
        if (!input || input.dataset.inputMemoryBound === "true") {
            return;
        }

        const state = getState(input, fieldKey);

        const onViewportChange = () => positionPanel(state);
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, true);

        input.addEventListener("focus", () => {
            window.clearTimeout(state.blurTimer);
            loadRemoteSuggestions().then(() => {
                updateSuggestions(state);
            });
        });

        input.addEventListener("input", () => {
            window.clearTimeout(state.blurTimer);
            scheduleUpdate(state);
        });

        input.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(state, 1);
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(state, -1);
                return;
            }

            if (event.key === "Enter" || event.key === "Tab") {
                if (!state.panel.hidden && state.activeIndex >= 0 && state.suggestions[state.activeIndex]) {
                    if (event.key === "Enter") {
                        event.preventDefault();
                    }
                    applySuggestion(state, state.suggestions[state.activeIndex]);
                }
                return;
            }

            if (event.key === "Escape") {
                hidePanel(state);
            }
        });

        input.addEventListener("blur", () => {
            state.blurTimer = window.setTimeout(() => hidePanel(state), 120);
        });

        state.panel.addEventListener("mousedown", (event) => {
            const option = event.target.closest(".input-memory-option");
            if (!option) {
                return;
            }

            event.preventDefault();
            const index = Number.parseInt(option.dataset.index, 10);
            applySuggestion(state, state.suggestions[index]);
            state.input.focus();
        });

        state.panel.addEventListener("mousemove", (event) => {
            const option = event.target.closest(".input-memory-option");
            if (!option) {
                return;
            }

            const index = Number.parseInt(option.dataset.index, 10);
            if (!Number.isNaN(index) && index !== state.activeIndex) {
                state.activeIndex = index;
                renderPanel(state);
            }
        });

        input.dataset.inputMemoryBound = "true";
    }

    function initializeOrderInputMemory(form) {
        if (!form) {
            return;
        }

        FIELD_CONFIGS.forEach((config) => {
            const input = form.querySelector(`#${config.inputId}`);
            if (input) {
                bindInputMemory(input, config.fieldKey);
            }
        });

        loadRemoteSuggestions().then(() => {
            FIELD_CONFIGS.forEach((config) => {
                const input = form.querySelector(`#${config.inputId}`);
                if (input) {
                    const state = getState(input, config.fieldKey);
                    if (document.activeElement === input) {
                        updateSuggestions(state);
                    }
                }
            });
        });
    }

    function recordOrderInputMemory(orderData) {
        if (!orderData || typeof orderData !== "object") {
            return;
        }

        FIELD_CONFIGS.forEach((config) => {
            const value = orderData[config.fieldKey];
            if (shouldTrackFieldValue(config.fieldKey, value)) {
                upsertVolatileMemory(config.fieldKey, value);
                upsertSessionMemory(config.fieldKey, value);
            }
        });
    }

    window.initializeOrderInputMemory = initializeOrderInputMemory;
    window.recordOrderInputMemory = recordOrderInputMemory;
})();
