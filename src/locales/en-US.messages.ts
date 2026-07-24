/**
 * Versioned English copy resource. New player-facing copy should be added here
 * instead of introducing another untracked string surface in a component.
 *
 * This is deliberately separate from numeric/date resources: changing words
 * must not alter accepted quiz-entry syntax or number formatting.
 */
export interface MessageLocaleResourceV1<
  Messages extends Readonly<Record<string, string>> = Readonly<
    Record<string, string>
  >,
> {
  readonly resource: "poker-training-pro-message-locale";
  readonly version: 1;
  readonly id: string;
  readonly intlLocale: string;
  readonly direction: "ltr" | "rtl";
  readonly messages: Messages;
}

export const EN_US_MESSAGES = Object.freeze({
  resource: "poker-training-pro-message-locale",
  version: 1,
  id: "en-US",
  intlLocale: "en-US",
  direction: "ltr",
  messages: Object.freeze({
    "common.back": "Back",
    "common.cancel": "Cancel",
    "common.continue": "Continue",
    "common.settings": "Settings",
    "common.play": "Play",
    "common.resume": "Resume",
    "common.close": "Close",
    "setup.welcome": "Welcome, {playerName}",
    "setup.comfort": "Make the table comfortable",
    "support.offline": "This build plays fully offline with no account, ads, analytics, or remote uploads.",
    "support.publisherPending": "Support contact is pending publisher assignment.",
    "table.skipOpponentAnimation": "Skip opponent animation",
  }),
} as const satisfies MessageLocaleResourceV1);

export type EnglishMessageKey = keyof typeof EN_US_MESSAGES.messages;
export type EnglishMessageLocaleResource = typeof EN_US_MESSAGES;
