(function (root, factory) {
  const exports = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }

  root.BillingFormula = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const INTERNAL_SCALE = 1000000n;
  const MAX_EXPRESSION_LENGTH = 80;
  const FORMULA_ENABLED_FIELDS = ["amount", "tax_rate", "exchange_rate"];
  const FIELD_PRECISION = {
    amount: 2,
    tax_rate: 4,
    exchange_rate: 4,
  };

  function normalizeText(value) {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }

  function isFormulaEnabledField(fieldKey) {
    return FORMULA_ENABLED_FIELDS.includes(fieldKey);
  }

  function getFieldPrecision(fieldKey) {
    return Object.prototype.hasOwnProperty.call(FIELD_PRECISION, fieldKey)
      ? FIELD_PRECISION[fieldKey]
      : 4;
  }

  function formatScaledInteger(value, precision) {
    const normalizedPrecision = Math.max(0, Number(precision) || 0);
    const isNegative = value < 0n;
    const absoluteValue = isNegative ? -value : value;
    const integerPart = absoluteValue / INTERNAL_SCALE;
    const fractionPart = absoluteValue % INTERNAL_SCALE;

    if (normalizedPrecision === 0) {
      return `${isNegative ? "-" : ""}${integerPart.toString()}`;
    }

    const fractionRaw = fractionPart.toString().padStart(6, "0").slice(0, normalizedPrecision);
    const fraction = fractionRaw.padEnd(normalizedPrecision, "0");
    return `${isNegative ? "-" : ""}${integerPart.toString()}.${fraction}`;
  }

  function trimFormattedNumber(value) {
    return value
      .replace(/(\.\d*?[1-9])0+$/u, "$1")
      .replace(/\.0+$/u, "")
      .replace(/^-0(?:\.0+)?$/u, "0");
  }

  function roundScaledValue(value, precision) {
    const digits = Math.max(0, 6 - Math.max(0, Number(precision) || 0));
    if (digits <= 0) {
      return value;
    }

    const divisor = 10n ** BigInt(digits);
    const half = divisor / 2n;
    if (value >= 0n) {
      return ((value + half) / divisor) * divisor;
    }

    return ((value - half) / divisor) * divisor;
  }

  function formatResultValue(fieldKey, scaledValue) {
    const precision = getFieldPrecision(fieldKey);
    const rounded = roundScaledValue(scaledValue, precision);
    return trimFormattedNumber(formatScaledInteger(rounded, precision));
  }

  function tokenizeExpression(rawExpression) {
    const normalized = normalizeText(rawExpression).replace(/\s+/gu, "");
    if (!normalized) {
      return { ok: false, error: "empty_expression" };
    }

    if (normalized.length > MAX_EXPRESSION_LENGTH) {
      return { ok: false, error: "expression_too_long" };
    }

    if (!/^[\d.+\-*/()]+$/u.test(normalized)) {
      return { ok: false, error: "unsupported_character" };
    }

    const tokens = [];
    let index = 0;
    while (index < normalized.length) {
      const char = normalized[index];
      if (/\d|\./u.test(char)) {
        let cursor = index + 1;
        while (cursor < normalized.length && /[\d.]/u.test(normalized[cursor])) {
          cursor += 1;
        }
        const numberToken = normalized.slice(index, cursor);
        if (!/^\d+(?:\.\d+)?$/u.test(numberToken) && !/^\.\d+$/u.test(numberToken)) {
          return { ok: false, error: "invalid_number" };
        }
        tokens.push({ type: "number", value: numberToken.startsWith(".") ? `0${numberToken}` : numberToken });
        index = cursor;
        continue;
      }

      if ("+-*/()".includes(char)) {
        tokens.push({ type: "operator", value: char });
        index += 1;
        continue;
      }

      return { ok: false, error: "unsupported_character" };
    }

    return { ok: true, normalized, tokens };
  }

  function parseDecimalToScaledInteger(rawNumber) {
    const normalized = normalizeText(rawNumber);
    const negative = normalized.startsWith("-");
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
    const safeInteger = integerPart || "0";
    const normalizedFraction = `${fractionPart}000000`.slice(0, 6);
    const scaled = BigInt(safeInteger) * INTERNAL_SCALE + BigInt(normalizedFraction || "0");
    return negative ? -scaled : scaled;
  }

  function divideScaledIntegers(left, right) {
    if (right === 0n) {
      throw new Error("division_by_zero");
    }

    const numerator = left * INTERNAL_SCALE;
    const negative = (numerator < 0n) !== (right < 0n);
    const absoluteNumerator = numerator < 0n ? -numerator : numerator;
    const absoluteDenominator = right < 0n ? -right : right;
    const quotient = absoluteNumerator / absoluteDenominator;
    const remainder = absoluteNumerator % absoluteDenominator;
    const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
    return negative ? -rounded : rounded;
  }

  function multiplyScaledIntegers(left, right) {
    const product = left * right;
    const negative = product < 0n;
    const absoluteProduct = negative ? -product : product;
    const quotient = absoluteProduct / INTERNAL_SCALE;
    const remainder = absoluteProduct % INTERNAL_SCALE;
    const rounded = remainder * 2n >= INTERNAL_SCALE ? quotient + 1n : quotient;
    return negative ? -rounded : rounded;
  }

  function evaluateTokenizedExpression(tokens) {
    let cursor = 0;

    function peek() {
      return tokens[cursor] || null;
    }

    function consume() {
      const token = tokens[cursor] || null;
      cursor += 1;
      return token;
    }

    function parseExpression() {
      let value = parseTerm();
      while (true) {
        const token = peek();
        if (!token || token.type !== "operator" || (token.value !== "+" && token.value !== "-")) {
          return value;
        }

        consume();
        const right = parseTerm();
        value = token.value === "+" ? value + right : value - right;
      }
    }

    function parseTerm() {
      let value = parseFactor();
      while (true) {
        const token = peek();
        if (!token || token.type !== "operator" || (token.value !== "*" && token.value !== "/")) {
          return value;
        }

        consume();
        const right = parseFactor();
        value = token.value === "*"
          ? multiplyScaledIntegers(value, right)
          : divideScaledIntegers(value, right);
      }
    }

    function parseFactor() {
      const token = peek();
      if (!token) {
        throw new Error("unexpected_end");
      }

      if (token.type === "operator" && token.value === "(") {
        consume();
        const inner = parseExpression();
        const closing = consume();
        if (!closing || closing.type !== "operator" || closing.value !== ")") {
          throw new Error("missing_closing_parenthesis");
        }
        return inner;
      }

      if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
        consume();
        const nextValue = parseFactor();
        return token.value === "-" ? -nextValue : nextValue;
      }

      if (token.type === "number") {
        consume();
        return parseDecimalToScaledInteger(token.value);
      }

      throw new Error("unexpected_token");
    }

    const result = parseExpression();
    if (cursor !== tokens.length) {
      throw new Error("unexpected_token");
    }

    return result;
  }

  function looksLikeFormula(value) {
    const normalized = normalizeText(value);
    return isSupportedExpressionText(normalized) && /[+\-*/()]/u.test(normalized) && /\d/u.test(normalized);
  }

  function looksLikeNumericLiteral(value) {
    const normalized = normalizeText(value);
    return /^-?(?:\d+|\d+\.\d+|\.\d+)$/u.test(normalized);
  }

  function isSupportedExpressionText(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return false;
    }

    return /^[\d.+\-*/()\s]+$/u.test(normalized);
  }

  function evaluateBillingExpression(rawExpression, fieldKey) {
    const tokenized = tokenizeExpression(rawExpression);
    if (!tokenized.ok) {
      return {
        ok: false,
        error: tokenized.error,
        raw: normalizeText(rawExpression),
      };
    }

    try {
      const scaledValue = evaluateTokenizedExpression(tokenized.tokens);
      return {
        ok: true,
        raw: normalizeText(rawExpression),
        normalized_expression: tokenized.normalized,
        scaled_value: scaledValue,
        formatted_value: formatResultValue(fieldKey, scaledValue),
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message || "invalid_expression",
        raw: normalizeText(rawExpression),
      };
    }
  }

  function normalizeBillingFieldValue(fieldKey, rawValue) {
    const raw = normalizeText(rawValue);
    if (!raw) {
      return {
        ok: true,
        value: "",
        raw,
        kind: "empty",
      };
    }

    if (!isFormulaEnabledField(fieldKey)) {
      return {
        ok: true,
        value: raw,
        raw,
        kind: "text",
      };
    }

    if (looksLikeNumericLiteral(raw)) {
      const evaluated = evaluateBillingExpression(raw, fieldKey);
      if (!evaluated.ok) {
        return {
          ok: false,
          value: raw,
          raw,
          kind: "numeric",
          error: evaluated.error,
        };
      }

      return {
        ok: true,
        value: evaluated.formatted_value,
        raw,
        kind: "numeric",
        computed: false,
      };
    }

    if (!looksLikeFormula(raw)) {
      return {
        ok: true,
        value: raw,
        raw,
        kind: "text",
      };
    }

    const evaluated = evaluateBillingExpression(raw, fieldKey);
    if (!evaluated.ok) {
      return {
        ok: false,
        value: raw,
        raw,
        kind: "formula",
        error: evaluated.error,
      };
    }

    return {
      ok: true,
      value: evaluated.formatted_value,
      raw,
      kind: "formula",
      computed: true,
      normalized_expression: evaluated.normalized_expression,
    };
  }

  function normalizeBillingItems(items, templateKey, normalizeItemsFn, options = {}) {
    const strict = options.strict !== false;
    const normalizedItems = Array.isArray(items) ? items : [];
    const mappedItems = normalizedItems.map((item) => {
      const nextItem = { ...(item || {}) };
      FORMULA_ENABLED_FIELDS.forEach((fieldKey) => {
        const result = normalizeBillingFieldValue(fieldKey, nextItem[fieldKey]);
        if (!result.ok) {
          if (!strict) {
            return;
          }
          const error = new Error(`${fieldKey}:${result.error}`);
          error.fieldKey = fieldKey;
          error.rawValue = result.raw;
          throw error;
        }
        nextItem[fieldKey] = result.value;
      });
      return nextItem;
    });

    return typeof normalizeItemsFn === "function"
      ? normalizeItemsFn(mappedItems, templateKey)
      : mappedItems;
  }

  return {
    FIELD_PRECISION,
    FORMULA_ENABLED_FIELDS,
    formatResultValue,
    isSupportedExpressionText,
    isFormulaEnabledField,
    looksLikeFormula,
    looksLikeNumericLiteral,
    normalizeBillingFieldValue,
    normalizeBillingItems,
    normalizeText,
  };
});
