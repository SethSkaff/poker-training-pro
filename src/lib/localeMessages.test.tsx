import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalizedMessage } from "../components/LocalizedMessage";
import { EN_US_MESSAGES } from "../locales/en-US.messages";
import {
  MESSAGE_LOCALE_RESOURCE_VERSION,
  createPseudoLocale,
  formatMessage,
  localeTextAttributes,
  pseudoLocalize,
} from "./localeMessages";

describe("versioned player-facing message resources", () => {
  it("uses an immutable explicit English resource and validates interpolation", () => {
    expect(EN_US_MESSAGES).toMatchObject({
      resource: "poker-training-pro-message-locale",
      version: MESSAGE_LOCALE_RESOURCE_VERSION,
      id: "en-US",
      direction: "ltr",
    });
    expect(Object.isFrozen(EN_US_MESSAGES)).toBe(true);
    expect(Object.isFrozen(EN_US_MESSAGES.messages)).toBe(true);
    expect(formatMessage("setup.welcome", { playerName: "Avery" })).toBe(
      "Welcome, Avery",
    );
    expect(() => formatMessage("missing.key")).toThrow(/unknown localized/i);
    expect(() => formatMessage("setup.welcome")).toThrow(/missing localized/i);
  });

  it("pseudo-localizes by 30–50%, preserves tokens, and exposes long text", () => {
    const source = EN_US_MESSAGES.messages["support.offline"];
    const pseudo = pseudoLocalize(source);
    const expansion = pseudo.length / source.length;

    expect(pseudo).toMatch(/^［.*］$/u);
    expect(expansion).toBeGreaterThanOrEqual(1.3);
    expect(expansion).toBeLessThanOrEqual(1.5);
    expect(pseudoLocalize("Welcome, {playerName}")).toContain("{playerName}");

    const pseudoLocale = createPseudoLocale();
    expect(formatMessage("setup.welcome", { playerName: "A_very_long_player_name_0123456789" }, pseudoLocale)).toContain(
      "A_very_long_player_name_0123456789",
    );
  });

  it("uses direction-aware, logical text layout for an RTL resource", () => {
    const rtlLocale = Object.freeze({
      ...EN_US_MESSAGES,
      id: "ar-XB-test",
      intlLocale: "ar",
      direction: "rtl" as const,
    });

    expect(localeTextAttributes(rtlLocale)).toEqual({ lang: "ar", dir: "rtl" });
    const markup = renderToStaticMarkup(
      <LocalizedMessage
        locale={rtlLocale}
        messageKey="setup.welcome"
        values={{ playerName: "Avery 12,400" }}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
    expect(markup).toContain("text-align:start");
    expect(markup).toContain("unicode-bidi:plaintext");
  });
});
