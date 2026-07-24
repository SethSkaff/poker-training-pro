/** Versioned date/time display resource, kept separate from numeric input syntax. */
export interface DateTimeLocaleResourceV1 {
  readonly resource: "poker-training-pro-date-time-locale";
  readonly version: 1;
  readonly id: string;
  readonly intlLocale: string;
  readonly options: Intl.DateTimeFormatOptions;
}

export const EN_US_DATE_TIME_LOCALE = Object.freeze({
  resource: "poker-training-pro-date-time-locale",
  version: 1,
  id: "en-US",
  intlLocale: "en-US",
  options: Object.freeze({
    dateStyle: "medium",
    timeStyle: "short",
  }),
} as const satisfies DateTimeLocaleResourceV1);
