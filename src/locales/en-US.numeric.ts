/**
 * Versioned English resource for numeric display and quiz-entry syntax only.
 * Player-facing component copy is intentionally outside this resource.
 */
export interface NumericLocaleResourceV1 {
  readonly resource: "poker-training-pro-numeric-locale";
  readonly version: 1;
  readonly id: string;
  readonly intlLocale: string;
  readonly acceptedDecimalSeparators: readonly ("." | ",")[];
  readonly ratioSeparator: string;
  readonly durationSeparator: string;
}

export const EN_US_NUMERIC_LOCALE = Object.freeze({
  resource: "poker-training-pro-numeric-locale",
  version: 1,
  id: "en-US",
  intlLocale: "en-US",
  acceptedDecimalSeparators: Object.freeze([".", ","] as const),
  ratioSeparator: ":",
  durationSeparator: ":",
} as const satisfies NumericLocaleResourceV1);

export type EnglishNumericLocaleResource = typeof EN_US_NUMERIC_LOCALE;
