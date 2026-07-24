import { useState } from "react";
import { ExternalLink, FolderOpen } from "lucide-react";
import { useCreditsResources } from "../lib/useCreditsResources";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";

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
      formatMessage(result.ok ? "about.folder.opened" : "about.folder.failed", {
        target,
      }),
    );
  };

  const unavailable = formatMessage("about.unavailable");
  const version = appInfo?.appVersion ?? unavailable;
  const buildId = appInfo?.buildId ?? unavailable;
  const savePath = appInfo?.paths.save;
  const logPath = appInfo?.paths.log;
  const privacyText = documents["privacy-policy"];

  return (
    <div className="night-settings__group about-support" {...localeTextAttributes()}>
      <h2>{formatMessage("about.heading")}</h2>

      <dl className="credits-versions">
        <div>
          <dt>{formatMessage("about.versionLabel")}</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>{formatMessage("about.buildIdLabel")}</dt>
          <dd>{buildId}</dd>
        </div>
      </dl>

      <div className="about-support__links">
        <button type="button" onClick={onOpenCredits}>
          {formatMessage("credits.title")}
        </button>
        {onExportDiagnostics ? (
          <button
            type="button"
            onClick={() => {
              void onExportDiagnostics().then((result) =>
                setStatus(
                  result.message ??
                    formatMessage(
                      result.ok
                        ? "saveData.diagnostics.success"
                        : "about.diagnostics.failed",
                    ),
                ),
              );
            }}
          >
            {formatMessage("shell.action.exportDiagnostics")}
          </button>
        ) : null}
      </div>

      <div className="about-support__paths">
        <div>
          <span className="about-support__path-label">
            {formatMessage("about.saveLocationLabel")}
          </span>
          <code>{savePath ?? unavailable}</code>
          {savePath ? (
            <button type="button" onClick={() => void openFolder("save")}>
              <FolderOpen size={15} /> {formatMessage("about.openFolder")}
            </button>
          ) : null}
        </div>
        <div>
          <span className="about-support__path-label">
            {formatMessage("about.logLocationLabel")}
          </span>
          <code>{logPath ?? unavailable}</code>
          {logPath ? (
            <button type="button" onClick={() => void openFolder("log")}>
              <FolderOpen size={15} /> {formatMessage("about.openFolder")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="about-support__privacy">
        <h3>{formatMessage("about.privacyHeading")}</h3>
        <p>{formatMessage("about.privacyIntro")}</p>
        <details className="credits-doc">
          <summary>{formatMessage("about.privacyPolicySummary")}</summary>
          {privacyText ? (
            <pre className="credits-doc__text">{privacyText}</pre>
          ) : (
            <p className="credits-doc__missing">
              {formatMessage("about.privacyPolicyUnavailable")}
            </p>
          )}
        </details>
        <p className="about-support__blocked">
          <ExternalLink size={13} aria-hidden="true" />{" "}
          {formatMessage("about.privacyPolicyBlocked")}
        </p>
      </div>

      <div className="about-support__contact">
        <h3>{formatMessage("about.supportHeading")}</h3>
        <p className="about-support__blocked">
          {formatMessage("about.supportBlocked")}
        </p>
      </div>

      {desktopUnavailable ? (
        <p className="night-audio-preview-status" role="status">
          {formatMessage("about.desktopUnavailable")}
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
