import {
  EN_US_DATE_TIME_LOCALE,
  type DateTimeLocaleResourceV1,
} from "../locales/en-US.dateTime";

export type DateTimeLocaleResource = DateTimeLocaleResourceV1;
export const DATE_TIME_LOCALE_RESOURCE_VERSION = 1;

/** Formats a valid saved timestamp through the explicit, versioned date resource. */
export function formatDateTime(
  value: string | Date,
  locale: DateTimeLocaleResource = EN_US_DATE_TIME_LOCALE,
): string {
  if (
    locale.resource !== "poker-training-pro-date-time-locale" ||
    locale.version !== DATE_TIME_LOCALE_RESOURCE_VERSION ||
    !locale.id ||
    !locale.intlLocale ||
    Intl.DateTimeFormat.supportedLocalesOf([locale.intlLocale]).length !== 1
  ) {
    throw new TypeError("Unsupported date/time locale resource.");
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Date/time value must be valid.");
  }
  return new Intl.DateTimeFormat(locale.intlLocale, locale.options).format(date);
}
