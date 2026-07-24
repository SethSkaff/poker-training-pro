import { describe, expect, it } from "vitest";
import { EN_US_NUMERIC_LOCALE } from "../locales/en-US.numeric";
import {
  MAX_QUIZ_INPUT_MAGNITUDE,
  NUMERIC_LOCALE_RESOURCE_VERSION,
  formatChipCount,
  formatDuration,
  formatFixedDecimal,
  formatNumber,
  formatPercentage,
  formatRatio,
  parseLocaleDecimal,
  parseQuizMathAnswer,
} from "./localeNumbers";

describe("versioned English numeric locale", () => {
  it("uses an explicit immutable resource and deterministic Intl locale", () => {
    expect(EN_US_NUMERIC_LOCALE).toMatchObject({
      resource: "poker-training-pro-numeric-locale",
      version: NUMERIC_LOCALE_RESOURCE_VERSION,
      id: "en-US",
      intlLocale: "en-US",
      acceptedDecimalSeparators: [".", ","],
    });
    expect(Object.isFrozen(EN_US_NUMERIC_LOCALE)).toBe(true);
    expect(
      Object.isFrozen(EN_US_NUMERIC_LOCALE.acceptedDecimalSeparators),
    ).toBe(true);
    expect(formatNumber(1234.5, {}, EN_US_NUMERIC_LOCALE)).toBe("1,234.5");
  });

  it("formats chips, percentage points, ratios, and durations", () => {
    expect(formatChipCount(1234567, EN_US_NUMERIC_LOCALE)).toBe(
      "1,234,567",
    );
    expect(formatPercentage(33.333, EN_US_NUMERIC_LOCALE, 1)).toBe(
      "33.3%",
    );
    expect(formatRatio(2.5, 1, EN_US_NUMERIC_LOCALE)).toBe("2.5:1");
    expect(formatFixedDecimal(33.333, 2, EN_US_NUMERIC_LOCALE)).toBe("33.33");
    expect(formatDuration(125_999, EN_US_NUMERIC_LOCALE)).toBe("2:05");
    expect(formatDuration(3_661_000, EN_US_NUMERIC_LOCALE)).toBe("61:01");
  });

  it("uses the injected Intl locale instead of the runtime default", () => {
    const injectedGermanSurface = Object.freeze({
      ...EN_US_NUMERIC_LOCALE,
      id: "de-DE-test",
      intlLocale: "de-DE",
      acceptedDecimalSeparators: Object.freeze([".", ","] as const),
    });

    expect(formatNumber(1234.5, {}, injectedGermanSurface)).toBe("1.234,5");
    expect(formatRatio(2.5, 1, injectedGermanSurface)).toBe("2,5:1");
    expect(parseLocaleDecimal("2,5", injectedGermanSurface)).toBe(2.5);
  });

  it("rejects non-finite, unsafe, negative-duration, and unknown resources", () => {
    expect(() => formatNumber(Number.NaN)).toThrow(/finite safe number/i);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(
      /finite safe number/i,
    );
    expect(() => formatNumber(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /finite safe number/i,
    );
    expect(() => formatDuration(-1)).toThrow(/cannot be negative/i);
    expect(() =>
      formatNumber(
        1,
        {},
        {
          ...EN_US_NUMERIC_LOCALE,
          version: 2,
        } as unknown as typeof EN_US_NUMERIC_LOCALE,
      ),
    ).toThrow(/unsupported numeric locale/i);
  });
});

describe("unambiguous localized quiz parsing", () => {
  it("accepts decimal point, decimal comma, and explicit space grouping", () => {
    expect(parseLocaleDecimal("33.5")).toBe(33.5);
    expect(parseLocaleDecimal("33,5")).toBe(33.5);
    expect(parseLocaleDecimal(",5")).toBe(0.5);
    expect(parseLocaleDecimal("5\u202f500")).toBe(5500);
    expect(parseLocaleDecimal("1 234 567,5")).toBe(1234567.5);
    expect(parseLocaleDecimal("1'234'567.5")).toBe(1234567.5);
  });

  it("preserves unit-specific fraction and colon semantics", () => {
    expect(parseQuizMathAnswer("1/3", "%")).toBeCloseTo(33.333, 2);
    expect(parseQuizMathAnswer("2:1", "%")).toBeCloseTo(33.333, 2);
    expect(parseQuizMathAnswer("3:5", "ratio")).toBe(0.6);
    expect(parseQuizMathAnswer("3/5", "ratio")).toBe(0.6);
    expect(parseQuizMathAnswer("1,5/3", "ratio")).toBe(0.5);
    expect(parseQuizMathAnswer("2,5:1", "%")).toBeCloseTo(28.571, 2);
  });

  it("distinguishes decimal percentages from explicit percentage points", () => {
    expect(parseQuizMathAnswer("0.33", "%")).toBe(33);
    expect(parseQuizMathAnswer("0,33", "%")).toBe(33);
    expect(parseQuizMathAnswer("0.33%", "%")).toBe(0.33);
    expect(parseQuizMathAnswer("33,5%", "%")).toBe(33.5);
    expect(parseQuizMathAnswer("50%", "chips")).toBeUndefined();
  });

  it("rejects mixed punctuation, repeated punctuation, and malformed grouping", () => {
    for (const input of [
      "1,234.5",
      "1.234,5",
      "1,2,3",
      "1.2.3",
      "5,500",
      "5.500",
      "12 34",
      "1 234\u202f567",
      "1 234,",
      "1 / 2 : 3",
      "1//3",
    ]) {
      expect(parseQuizMathAnswer(input, "chips"), input).toBeUndefined();
    }
  });

  it("rejects negative, non-finite, zero denominator, and extreme values", () => {
    expect(parseQuizMathAnswer("-1", "outs")).toBeUndefined();
    expect(parseQuizMathAnswer("1/0", "%")).toBeUndefined();
    expect(parseQuizMathAnswer("0:0", "%")).toBeUndefined();
    expect(parseQuizMathAnswer("Infinity", "chips")).toBeUndefined();
    expect(
      parseQuizMathAnswer(
        String(MAX_QUIZ_INPUT_MAGNITUDE + 1),
        "chips",
      ),
    ).toBeUndefined();
    expect(parseQuizMathAnswer("9".repeat(129), "chips")).toBeUndefined();
  });
});
