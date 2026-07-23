import {
  EN_US_NUMERIC_LOCALE,
  type NumericLocaleResourceV1,
} from "../locales/en-US.numeric";
import type { MathQuestion } from "../types/poker";

export type NumericLocaleResource = NumericLocaleResourceV1;

export const NUMERIC_LOCALE_RESOURCE_VERSION = 1;
export const MAX_QUIZ_INPUT_MAGNITUDE = 1_000_000_000_000;

const MAX_INPUT_LENGTH = 128;
const GROUP_CHARACTERS = /[ \u00a0\u202f']/;
const ALL_GROUP_CHARACTERS = /[ \u00a0\u202f']/g;

export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale: NumericLocaleResource = EN_US_NUMERIC_LOCALE,
): string {
  assertLocale(locale);
  assertDisplayNumber(value);
  return new Intl.NumberFormat(locale.intlLocale, options).format(value);
}

export function formatChipCount(
  value: number,
  locale: NumericLocaleResource = EN_US_NUMERIC_LOCALE,
): string {
  return formatNumber(
    value,
    {
      maximumFractionDigits: 0,
      useGrouping: true,
    },
    locale,
  );
}

/**
 * Formats percentage points, so `33.3` renders as `33.3%`.
 */
export function formatPercentage(
  percentagePoints: number,
  locale: NumericLocaleResource = EN_US_NUMERIC_LOCALE,
  maximumFractionDigits = 1,
): string {
  if (
    !Number.isInteger(maximumFractionDigits) ||
    maximumFractionDigits < 0 ||
    maximumFractionDigits > 6
  ) {
    throw new RangeError("maximumFractionDigits must be from 0 to 6.");
  }
  return formatNumber(
    percentagePoints / 100,
    {
      style: "percent",
      maximumFractionDigits,
      minimumFractionDigits: 0,
    },
    locale,
  );
}

export function formatRatio(
  first: number,
  second: number,
  locale: NumericLocaleResource = EN_US_NUMERIC_LOCALE,
  maximumFractionDigits = 2,
): string {
  assertLocale(locale);
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits,
    useGrouping: false,
  };
  return `${formatNumber(first, options, locale)}${locale.ratioSeparator}${formatNumber(second, options, locale)}`;
}

export function formatDuration(
  milliseconds: number,
  locale: NumericLocaleResource = EN_US_NUMERIC_LOCALE,
): string {
  assertLocale(locale);
  assertDisplayNumber(milliseconds);
  if (milliseconds < 0) {
    throw new RangeError("Duration cannot be negative.");
  }
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const minuteText = formatNumber(
    minutes,
    { maximumFractionDigits: 0, useGrouping: false },
    locale,
  );
  const secondText = formatNumber(
    remainder,
    {
      maximumFractionDigits: 0,
      minimumIntegerDigits: 2,
      useGrouping: false,
    },
    locale,
  );
  return `${minuteText}${locale.durationSeparator}${secondText}`;
}

/**
 * Parses the compact forms poker players use without guessing whether comma
 * or point punctuation is grouping. Punctuation is decimal unless its shape
 * is indistinguishable from a three-digit group, which is rejected; explicit
 * grouping uses a consistent space, NBSP, narrow NBSP, or apostrophe.
 */
export function parseQuizMathAnswer(
  input: string,
  unit: MathQuestion["unit"],
  locale: NumericLocaleResource = EN_US_NUMERIC_LOCALE,
): number | undefined {
  assertLocale(locale);
  if (typeof input !== "string" || input.length > MAX_INPUT_LENGTH) {
    return undefined;
  }
  const normalized = input.trim();
  if (!normalized) return undefined;

  const percentMarked = normalized.endsWith("%");
  if (percentMarked && unit !== "%") return undefined;
  const valueText = percentMarked
    ? normalized.slice(0, -1).trim()
    : normalized;
  if (!valueText || valueText.includes("%")) return undefined;

  const fractionParts = splitOnce(valueText, "/");
  const ratioParts = splitOnce(valueText, ":");
  if (fractionParts && ratioParts) return undefined;

  let value: number;
  if (fractionParts) {
    const numerator = parseLocaleDecimal(fractionParts[0], locale);
    const denominator = parseLocaleDecimal(fractionParts[1], locale);
    if (
      numerator === undefined ||
      denominator === undefined ||
      denominator === 0
    ) {
      return undefined;
    }
    value = numerator / denominator;
    if (unit === "%") value *= 100;
  } else if (ratioParts) {
    const first = parseLocaleDecimal(ratioParts[0], locale);
    const second = parseLocaleDecimal(ratioParts[1], locale);
    if (first === undefined || second === undefined) return undefined;
    if (unit === "%") {
      const total = first + second;
      if (total === 0) return undefined;
      // Percentage questions use poker odds-against notation:
      // 2:1 means one favorable outcome in three total outcomes.
      value = (second / total) * 100;
    } else {
      if (second === 0) return undefined;
      value = first / second;
    }
  } else {
    const parsed = parseLocaleDecimal(valueText, locale);
    if (parsed === undefined) return undefined;
    value = parsed;
    if (
      unit === "%" &&
      !percentMarked &&
      value > 0 &&
      value < 1
    ) {
      value *= 100;
    }
  }

  return Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_QUIZ_INPUT_MAGNITUDE
    ? value
    : undefined;
}

export function parseLocaleDecimal(
  input: string,
  locale: NumericLocaleResource = EN_US_NUMERIC_LOCALE,
): number | undefined {
  assertLocale(locale);
  const token = input.trim();
  if (!token || token.length > MAX_INPUT_LENGTH) return undefined;

  let sign = "";
  let unsigned = token;
  if (unsigned.startsWith("+") || unsigned.startsWith("-")) {
    sign = unsigned[0];
    unsigned = unsigned.slice(1);
  }
  if (!unsigned || sign === "-") return undefined;

  const commaCount = count(unsigned, ",");
  const pointCount = count(unsigned, ".");
  if (commaCount > 0 && pointCount > 0) return undefined;
  if (commaCount > 1 || pointCount > 1) return undefined;

  const punctuation = commaCount === 1 ? "," : pointCount === 1 ? "." : "";
  if (
    punctuation &&
    !locale.acceptedDecimalSeparators.includes(
      punctuation as "." | ",",
    )
  ) {
    return undefined;
  }

  let integerPart = punctuation
    ? unsigned.slice(0, unsigned.indexOf(punctuation))
    : unsigned;
  const fractionalPart = punctuation
    ? unsigned.slice(unsigned.indexOf(punctuation) + 1)
    : undefined;
  if (fractionalPart !== undefined && !/^\d+$/.test(fractionalPart)) {
    return undefined;
  }
  if (
    fractionalPart?.length === 3 &&
    /^[1-9]\d{0,2}$/.test(integerPart) &&
    !GROUP_CHARACTERS.test(integerPart)
  ) {
    // `5,500` and `5.500` can both mean either a decimal or a grouped
    // integer across supported entry conventions. Reject instead of guessing.
    return undefined;
  }

  if (GROUP_CHARACTERS.test(integerPart)) {
    const grouping = integerPart.match(GROUP_CHARACTERS)?.[0];
    if (!grouping) return undefined;
    const escaped = escapeRegExp(grouping);
    if (
      !new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`).test(integerPart)
    ) {
      return undefined;
    }
    integerPart = integerPart.replace(ALL_GROUP_CHARACTERS, "");
  } else if (integerPart && !/^\d+$/.test(integerPart)) {
    return undefined;
  }

  if (!integerPart && fractionalPart === undefined) return undefined;
  const normalized = `${sign}${integerPart || "0"}${
    fractionalPart === undefined ? "" : `.${fractionalPart}`
  }`;
  const value = Number(normalized);
  return Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_QUIZ_INPUT_MAGNITUDE
    ? value
    : undefined;
}

function splitOnce(value: string, separator: "/" | ":"):
  | [string, string]
  | undefined {
  if (!value.includes(separator)) return undefined;
  const pieces = value.split(separator);
  if (
    pieces.length !== 2 ||
    pieces[0].trim().length === 0 ||
    pieces[1].trim().length === 0
  ) {
    return ["", ""];
  }
  return [pieces[0], pieces[1]];
}

function count(value: string, token: string): number {
  return value.split(token).length - 1;
}

function assertLocale(
  locale: NumericLocaleResource,
): asserts locale is NumericLocaleResource {
  if (
    locale.resource !== "poker-training-pro-numeric-locale" ||
    locale.version !== NUMERIC_LOCALE_RESOURCE_VERSION ||
    typeof locale.id !== "string" ||
    locale.id.length === 0 ||
    locale.id.length > 64 ||
    typeof locale.intlLocale !== "string" ||
    locale.intlLocale.length === 0 ||
    locale.intlLocale.length > 64 ||
    Intl.NumberFormat.supportedLocalesOf([locale.intlLocale]).length !== 1 ||
    locale.acceptedDecimalSeparators.length === 0 ||
    locale.acceptedDecimalSeparators.length > 2 ||
    !locale.acceptedDecimalSeparators.every(
      (separator) => separator === "." || separator === ",",
    ) ||
    new Set(locale.acceptedDecimalSeparators).size !==
      locale.acceptedDecimalSeparators.length ||
    typeof locale.ratioSeparator !== "string" ||
    locale.ratioSeparator.length !== 1 ||
    typeof locale.durationSeparator !== "string" ||
    locale.durationSeparator.length !== 1
  ) {
    throw new TypeError("Unsupported numeric locale resource.");
  }
}

function assertDisplayNumber(value: number): void {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Display value must be a finite safe number.");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
