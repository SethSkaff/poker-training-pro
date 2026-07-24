/**
 * Pure assembly of the Credits / Licenses model.
 *
 * All environment data (runtime versions, bundled document text) is injected so
 * the model can be assembled and asserted deterministically in tests without a
 * real Electron bridge. The React screen simply fetches the inputs and renders
 * whatever this function returns.
 */

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

const UNKNOWN = "Unavailable";

export const CREDITS_DOCUMENT_LABELS: Record<BundledDocumentId, string> = {
  "privacy-policy": "Privacy policy",
  "third-party-packages": "npm package notices",
  "third-party-runtime": "Bundled runtime notices",
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
    { label: "Poker Training Pro", value: info?.appVersion ?? UNKNOWN },
    { label: "Build identifier", value: info?.buildId ?? UNKNOWN },
    { label: "Electron", value: info?.versions.electron ?? UNKNOWN },
    { label: "Chromium", value: info?.versions.chromium ?? UNKNOWN },
    { label: "Node.js", value: info?.versions.node ?? UNKNOWN },
  ];

  return {
    appName: "Poker Training Pro",
    musicStatus:
      "No licensed music ships in this build. Background music stays disabled " +
      "until instrumental masters are licensed, loudness-normalised, and " +
      "attributed here.",
    sections: [
      {
        id: "application",
        title: "Application",
        note: "Version and runtime identifiers for this build.",
        versions,
      },
      {
        id: "fonts",
        title: "Fonts",
        note: "Bundled local fonts under the SIL Open Font License 1.1.",
        documents: [
          document("font-inter", input.documents),
          document("font-barlow", input.documents),
        ],
      },
      {
        id: "packages",
        title: "Open-source software",
        note:
          "Notices for the npm packages compiled into this build. These are " +
          "bundled copies, shown offline; nothing is fetched.",
        documents: [
          document("third-party-packages", input.documents),
          document("third-party-runtime", input.documents),
        ],
      },
      {
        id: "music",
        title: "Music",
        note:
          "No instrumental soundtrack is included yet. When licensed tracks " +
          "ship, each track's title, author, source, and license will appear " +
          "here.",
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
