/**
 * Pure assembly of the Credits / Licenses model.
 *
 * All environment data (runtime versions, bundled document text) is injected so
 * the model can be assembled and asserted deterministically in tests without a
 * real Electron bridge. The React screen simply fetches the inputs and renders
 * whatever this function returns.
 *
 * Section titles/notes, version-row labels, and most document labels are UI
 * chrome and resolve through the message catalog (`credits.*` keys in
 * src/locales/en-US.messages.shell.ts). The bundled license/notice TEXT
 * itself (`documents[].text`, injected via `CreditsInput.documents`) and the
 * font document labels that pair a font's proper name with its license name
 * ("Inter — SIL Open Font License 1.1") stay verbatim, untranslated literals
 * — they are proper nouns and third-party legal text, not composed prose.
 */
import { formatMessage } from "./localeMessages";

export type BundledDocumentId =
  | "privacy-policy"
  | "third-party-packages"
  | "third-party-runtime"
  | "font-inter"
  | "font-barlow";

export interface DesktopAppInfo {
  readonly appVersion: string;
  readonly buildId: string;
  readonly versions: {
    readonly electron: string;
    readonly chromium: string;
    readonly node: string;
  };
  readonly paths: {
    readonly save: string;
    readonly log: string;
  };
  readonly packaged: boolean;
  readonly platform: string;
  readonly arch: string;
}

export interface CreditsDocument {
  readonly id: BundledDocumentId;
  readonly label: string;
  /** Bundled text, or `undefined` when it could not be read. */
  readonly text?: string;
}

export interface CreditsVersionRow {
  readonly label: string;
  readonly value: string;
}

export interface CreditsSection {
  readonly id: string;
  readonly title: string;
  /** Optional plain-language note describing the section. */
  readonly note?: string;
  readonly versions?: readonly CreditsVersionRow[];
  readonly documents?: readonly CreditsDocument[];
}

export interface CreditsModel {
  readonly appName: string;
  readonly sections: readonly CreditsSection[];
  /** Truthful music status; there are no licensed masters yet. */
  readonly musicStatus: string;
}

const UNKNOWN = formatMessage("about.unavailable");

export const CREDITS_DOCUMENT_LABELS: Record<BundledDocumentId, string> = {
  // Reuses AboutSupport's existing "Privacy policy" label (byte-identical
  // text, same UI chrome concept) rather than duplicating a second key.
  "privacy-policy": formatMessage("about.privacyPolicySummary"),
  "third-party-packages": formatMessage(
    "credits.document.label.thirdPartyPackages",
  ),
  "third-party-runtime": formatMessage(
    "credits.document.label.thirdPartyRuntime",
  ),
  // NOT migrated: these pair a font's proper name with its license name and
  // are proper nouns/license identifiers, not composed UI prose.
  "font-inter": "Inter — SIL Open Font License 1.1",
  "font-barlow": "Barlow Condensed — SIL Open Font License 1.1",
};

export interface CreditsInput {
  readonly appInfo?: DesktopAppInfo;
  /** Text keyed by bundled document id; missing keys render as unavailable. */
  readonly documents?: Partial<Record<BundledDocumentId, string | undefined>>;
}

function document(
  id: BundledDocumentId,
  documents: CreditsInput["documents"],
): CreditsDocument {
  const text = documents?.[id];
  return {
    id,
    label: CREDITS_DOCUMENT_LABELS[id],
    ...(typeof text === "string" && text.length > 0 ? { text } : {}),
  };
}

export function assembleCredits(input: CreditsInput = {}): CreditsModel {
  const info = input.appInfo;
  const versions: CreditsVersionRow[] = [
    {
      label: formatMessage("shell.productName"),
      value: info?.appVersion ?? UNKNOWN,
    },
    {
      label: formatMessage("credits.versionRow.buildId"),
      value: info?.buildId ?? UNKNOWN,
    },
    {
      label: formatMessage("credits.versionRow.electron"),
      value: info?.versions.electron ?? UNKNOWN,
    },
    {
      label: formatMessage("credits.versionRow.chromium"),
      value: info?.versions.chromium ?? UNKNOWN,
    },
    {
      label: formatMessage("credits.versionRow.nodeJs"),
      value: info?.versions.node ?? UNKNOWN,
    },
  ];

  return {
    appName: formatMessage("shell.productName"),
    musicStatus: formatMessage("credits.musicStatus"),
    sections: [
      {
        id: "application",
        title: formatMessage("credits.section.application.title"),
        note: formatMessage("credits.section.application.note"),
        versions,
      },
      {
        id: "fonts",
        title: formatMessage("credits.section.fonts.title"),
        note: formatMessage("credits.section.fonts.note"),
        documents: [
          document("font-inter", input.documents),
          document("font-barlow", input.documents),
        ],
      },
      {
        id: "packages",
        title: formatMessage("credits.section.packages.title"),
        note: formatMessage("credits.section.packages.note"),
        documents: [
          document("third-party-packages", input.documents),
          document("third-party-runtime", input.documents),
        ],
      },
      {
        id: "music",
        title: formatMessage("credits.section.music.title"),
        note: formatMessage("credits.section.music.note"),
      },
    ],
  };
}

/** All bundled documents the Credits and About screens may request. */
export const CREDITS_DOCUMENT_IDS: readonly BundledDocumentId[] = [
  "privacy-policy",
  "third-party-packages",
  "third-party-runtime",
  "font-inter",
  "font-barlow",
];
