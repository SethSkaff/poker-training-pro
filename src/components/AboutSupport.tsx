import { useState } from "react";
import { ExternalLink, FolderOpen } from "lucide-react";
import { useCreditsResources } from "../lib/useCreditsResources";

interface AboutSupportProps {
  onOpenCredits: () => void;
  onExportDiagnostics?: () => Promise<{ ok: boolean; message?: string }>;
}

export function AboutSupport({
  onOpenCredits,
  onExportDiagnostics,
}: AboutSupportProps) {
  const { appInfo, documents, desktopUnavailable } = useCreditsResources();
  const [status, setStatus] = useState<string>();

  const openFolder = async (target: "save" | "log") => {
    if (!window.desktop) return;
    const result = await window.desktop.openFolder(target);
    setStatus(
      result.ok
        ? `Opened the ${target} folder.`
        : `The ${target} folder could not be opened.`,
    );
  };

  const version = appInfo?.appVersion ?? "Unavailable";
  const buildId = appInfo?.buildId ?? "Unavailable";
  const savePath = appInfo?.paths.save;
  const logPath = appInfo?.paths.log;
  const privacyText = documents["privacy-policy"];

  return (
    <div className="night-settings__group about-support">
      <h2>About &amp; support</h2>

      <dl className="credits-versions">
        <div>
          <dt>Version</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>Build identifier</dt>
          <dd>{buildId}</dd>
        </div>
      </dl>

      <div className="about-support__links">
        <button type="button" onClick={onOpenCredits}>
          Credits &amp; licenses
        </button>
        {onExportDiagnostics ? (
          <button
            type="button"
            onClick={() => {
              void onExportDiagnostics().then((result) =>
                setStatus(
                  result.message ??
                    (result.ok
                      ? "Redacted diagnostics exported."
                      : "Diagnostics export failed."),
                ),
              );
            }}
          >
            Export diagnostics
          </button>
        ) : null}
      </div>

      <div className="about-support__paths">
        <div>
          <span className="about-support__path-label">Save location</span>
          <code>{savePath ?? "Unavailable"}</code>
          {savePath ? (
            <button type="button" onClick={() => void openFolder("save")}>
              <FolderOpen size={15} /> Open folder
            </button>
          ) : null}
        </div>
        <div>
          <span className="about-support__path-label">Log location</span>
          <code>{logPath ?? "Unavailable"}</code>
          {logPath ? (
            <button type="button" onClick={() => void openFolder("log")}>
              <FolderOpen size={15} /> Open folder
            </button>
          ) : null}
        </div>
      </div>

      <div className="about-support__privacy">
        <h3>Privacy</h3>
        <p>
          This build plays fully offline with no account, ads, analytics, or
          remote uploads. The full policy is bundled below.
        </p>
        <details className="credits-doc">
          <summary>Privacy policy</summary>
          {privacyText ? (
            <pre className="credits-doc__text">{privacyText}</pre>
          ) : (
            <p className="credits-doc__missing">
              The bundled privacy policy is unavailable in this preview.
            </p>
          )}
        </details>
        <p className="about-support__blocked">
          <ExternalLink size={13} aria-hidden="true" /> A stable public HTTPS
          copy of this policy is a separate item that is still blocked pending
          the publisher.
        </p>
      </div>

      <div className="about-support__contact">
        <h3>Support</h3>
        <p className="about-support__blocked">
          Support contact: pending publisher assignment. No email or web address
          is published yet.
        </p>
      </div>

      {desktopUnavailable ? (
        <p className="night-audio-preview-status" role="status">
          Version, folder, and bundled-document details are available in the
          desktop app.
        </p>
      ) : null}
      {status ? (
        <p
          className="night-audio-preview-status"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
