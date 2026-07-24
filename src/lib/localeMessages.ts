import {
  EN_US_MESSAGES,
  type MessageLocaleResourceV1,
} from "../locales/en-US.messages";

export const MESSAGE_LOCALE_RESOURCE_VERSION = 1 as const;

export type MessageValues = Readonly<Record<string, string | number>>;

/**
 * Resolve a versioned player-facing message. Missing keys or interpolation
 * values fail loudly in development/tests instead of silently shipping raw
 * token syntax to a player.
 */
export function formatMessage(
  key: string,
  values: MessageValues = {},
  locale: MessageLocaleResourceV1 = EN_US_MESSAGES,
): string {
  assertMessageLocale(locale);
  const template = locale.messages[key];
  if (template === undefined) {
    throw new RangeError(`Unknown localized message key: ${key}`);
  }

  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new RangeError(`Missing localized message value: ${name}`);
    }
    return String(value);
  });
}

/** DOM attributes use logical text direction, not physical left/right layout. */
export function localeTextAttributes(
  locale: MessageLocaleResourceV1 = EN_US_MESSAGES,
): Readonly<{ lang: string; dir: "ltr" | "rtl" }> {
  assertMessageLocale(locale);
  return Object.freeze({ lang: locale.intlLocale, dir: locale.direction });
}

/**
 * A deterministic en-XA-style surface for visual tests. Tokens such as
 * `{playerName}` remain byte-for-byte intact so placeholder regressions are
 * visible separately from expansion/layout regressions.
 */
export function createPseudoLocale(
  source: MessageLocaleResourceV1 = EN_US_MESSAGES,
): MessageLocaleResourceV1 {
  assertMessageLocale(source);
  return Object.freeze({
    resource: "poker-training-pro-message-locale",
    version: MESSAGE_LOCALE_RESOURCE_VERSION,
    id: `${source.id}-XA`,
    intlLocale: source.intlLocale,
    direction: "ltr",
    messages: Object.freeze(
      Object.fromEntries(
        Object.entries(source.messages).map(([key, value]) => [
          key,
          pseudoLocalize(value),
        ]),
      ),
    ),
  });
}

export function pseudoLocalize(text: string): string {
  if (!text) return "［］";

  // Preserve interpolation tokens, including their spelling and braces.
  const parts = text.split(/(\{[A-Za-z][A-Za-z0-9_]*\})/g);
  const transformed = parts
    .map((part) =>
      /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(part)
        ? part
        : part.replace(/[A-Za-z]/g, pseudoCharacter),
    )
    .join("");

  // 35% expansion catches fixed-width assumptions without turning labels into
  // unreadable walls of filler. Wide brackets make accidental unlocalized copy
  // obvious in visual review.
  const targetLength = Math.ceil(text.length * 1.35);
  const padding = "~".repeat(Math.max(0, targetLength - transformed.length));
  return `［${transformed}${padding}］`;
}

function pseudoCharacter(character: string): string {
  const alphabet: Record<string, string> = {
    A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "Ë", F: "Ƒ", G: "Ĝ", H: "Ħ",
    I: "Ï", J: "Ĵ", K: "Ķ", L: "Ŀ", M: "Ḿ", N: "Ń", O: "Ø", P: "Þ",
    Q: "Ɋ", R: "Ŕ", S: "Š", T: "Ŧ", U: "Ü", V: "Ṽ", W: "Ŵ", X: "Ẋ",
    Y: "Ÿ", Z: "Ž", a: "å", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ",
    g: "ĝ", h: "ħ", i: "ï", j: "ĵ", k: "ķ", l: "ŀ", m: "ḿ", n: "ń",
    o: "ø", p: "þ", q: "ɋ", r: "ŕ", s: "š", t: "ŧ", u: "ü", v: "ṽ",
    w: "ŵ", x: "ẋ", y: "ÿ", z: "ž",
  };
  return alphabet[character] ?? character;
}

function assertMessageLocale(
  locale: MessageLocaleResourceV1,
): asserts locale is MessageLocaleResourceV1 {
  if (
    locale.resource !== "poker-training-pro-message-locale" ||
    locale.version !== MESSAGE_LOCALE_RESOURCE_VERSION ||
    !locale.id ||
    !locale.intlLocale ||
    (locale.direction !== "ltr" && locale.direction !== "rtl") ||
    Intl.NumberFormat.supportedLocalesOf([locale.intlLocale]).length !== 1 ||
    !locale.messages ||
    Object.values(locale.messages).some((value) => typeof value !== "string")
  ) {
    throw new TypeError("Unsupported message locale resource.");
  }
}
