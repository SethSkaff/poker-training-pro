import { describe, expect, it } from "vitest";
import { EN_US_DATE_TIME_LOCALE } from "../locales/en-US.dateTime";
import {
  DATE_TIME_LOCALE_RESOURCE_VERSION,
  formatDateTime,
} from "./localeDateTime";

describe("versioned English date/time locale", () => {
  it("formats timestamps through an explicit resource rather than host defaults", () => {
    expect(EN_US_DATE_TIME_LOCALE).toMatchObject({
      resource: "poker-training-pro-date-time-locale",
      version: DATE_TIME_LOCALE_RESOURCE_VERSION,
      id: "en-US",
      intlLocale: "en-US",
    });
    expect(Object.isFrozen(EN_US_DATE_TIME_LOCALE)).toBe(true);
    expect(formatDateTime("2026-07-23T20:05:00.000Z")).toMatch(/Jul 23, 2026/);
  });

  it("rejects invalid timestamps and unknown resources", () => {
    expect(() => formatDateTime("not-a-date")).toThrow(/must be valid/i);
    expect(() =>
      formatDateTime("2026-07-23T20:05:00.000Z", {
        ...EN_US_DATE_TIME_LOCALE,
        version: 2,
      } as unknown as typeof EN_US_DATE_TIME_LOCALE),
    ).toThrow(/unsupported date\/time locale/i);
  });
});
