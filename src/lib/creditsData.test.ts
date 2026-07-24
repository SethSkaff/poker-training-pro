import { describe, expect, it } from "vitest";
import {
  assembleCredits,
  CREDITS_DOCUMENT_IDS,
  CREDITS_DOCUMENT_LABELS,
  type DesktopAppInfo,
} from "./creditsData";
import { formatMessage } from "./localeMessages";

const appInfo: DesktopAppInfo = {
  appVersion: "0.1.0",
  buildId: "0.1.0+win32-x64",
  versions: { electron: "43.2.0", chromium: "128.0.0", node: "22.14.0" },
  paths: { save: "C:/save", log: "C:/log" },
  packaged: true,
  platform: "win32",
  arch: "x64",
};

describe("assembleCredits", () => {
  it("surfaces version and runtime rows from app info", () => {
    const model = assembleCredits({ appInfo });
    const application = model.sections.find((s) => s.id === "application");
    const values = application?.versions?.map((row) => row.value);
    expect(values).toEqual([
      "0.1.0",
      "0.1.0+win32-x64",
      "43.2.0",
      "128.0.0",
      "22.14.0",
    ]);
  });

  it("marks versions unavailable when no app info is supplied", () => {
    const model = assembleCredits();
    const application = model.sections.find((s) => s.id === "application");
    expect(
      application?.versions?.every((row) => row.value === "Unavailable"),
    ).toBe(true);
  });

  it("includes bundled font and package notice documents when provided", () => {
    const model = assembleCredits({
      appInfo,
      documents: {
        "font-inter": "Copyright Inter OFL",
        "third-party-packages": "# Package notices",
      },
    });
    const fonts = model.sections.find((s) => s.id === "fonts");
    const inter = fonts?.documents?.find((d) => d.id === "font-inter");
    expect(inter?.text).toBe("Copyright Inter OFL");
    const barlow = fonts?.documents?.find((d) => d.id === "font-barlow");
    // Missing document text renders as unavailable (no text field).
    expect(barlow?.text).toBeUndefined();
  });

  it("truthfully reports that no licensed music ships yet", () => {
    const model = assembleCredits({ appInfo });
    expect(model.musicStatus.toLowerCase()).toContain("no licensed music");
    const music = model.sections.find((s) => s.id === "music");
    expect(music).toBeDefined();
    expect(music?.documents).toBeUndefined();
  });

  it("exposes exactly the allowlisted bundled document ids", () => {
    expect([...CREDITS_DOCUMENT_IDS].sort()).toEqual([
      "font-barlow",
      "font-inter",
      "privacy-policy",
      "third-party-packages",
      "third-party-runtime",
    ]);
  });

  it("resolves section chrome and non-font document labels through the message catalog", () => {
    const model = assembleCredits({ appInfo });
    const application = model.sections.find((s) => s.id === "application");
    const fonts = model.sections.find((s) => s.id === "fonts");
    const packages = model.sections.find((s) => s.id === "packages");
    const music = model.sections.find((s) => s.id === "music");

    expect(model.appName).toBe(formatMessage("shell.productName"));
    expect(model.musicStatus).toBe(formatMessage("credits.musicStatus"));
    expect(application?.title).toBe(
      formatMessage("credits.section.application.title"),
    );
    expect(application?.note).toBe(
      formatMessage("credits.section.application.note"),
    );
    expect(application?.versions?.map((row) => row.label)).toEqual([
      formatMessage("shell.productName"),
      formatMessage("credits.versionRow.buildId"),
      formatMessage("credits.versionRow.electron"),
      formatMessage("credits.versionRow.chromium"),
      formatMessage("credits.versionRow.nodeJs"),
    ]);
    expect(fonts?.title).toBe(formatMessage("credits.section.fonts.title"));
    expect(fonts?.note).toBe(formatMessage("credits.section.fonts.note"));
    expect(packages?.title).toBe(
      formatMessage("credits.section.packages.title"),
    );
    expect(packages?.note).toBe(formatMessage("credits.section.packages.note"));
    expect(music?.title).toBe(formatMessage("credits.section.music.title"));
    expect(music?.note).toBe(formatMessage("credits.section.music.note"));

    expect(CREDITS_DOCUMENT_LABELS["privacy-policy"]).toBe(
      formatMessage("about.privacyPolicySummary"),
    );
    expect(CREDITS_DOCUMENT_LABELS["third-party-packages"]).toBe(
      formatMessage("credits.document.label.thirdPartyPackages"),
    );
    expect(CREDITS_DOCUMENT_LABELS["third-party-runtime"]).toBe(
      formatMessage("credits.document.label.thirdPartyRuntime"),
    );
  });

  it("keeps font document labels as verbatim proper-noun/license literals, not catalog keys", () => {
    // These pair a font's proper name with its license name -- deliberately
    // NOT migrated (see the module doc comment in creditsData.ts).
    expect(CREDITS_DOCUMENT_LABELS["font-inter"]).toBe(
      "Inter — SIL Open Font License 1.1",
    );
    expect(CREDITS_DOCUMENT_LABELS["font-barlow"]).toBe(
      "Barlow Condensed — SIL Open Font License 1.1",
    );
  });
});
