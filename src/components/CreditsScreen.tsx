import { ArrowLeft } from "lucide-react";
import { assembleCredits, type CreditsDocument } from "../lib/creditsData";
import { useCreditsResources } from "../lib/useCreditsResources";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
import { NightCircuitScene } from "./Dashboard";

interface CreditsScreenProps {
  onBack: () => void;
}

function DocumentBlock({ document }: { document: CreditsDocument }) {
  return (
    <details className="credits-doc">
      <summary>{document.label}</summary>
      {document.text ? (
        <pre className="credits-doc__text">{document.text}</pre>
      ) : (
        <p className="credits-doc__missing">
          {formatMessage("credits.document.unavailable")}
        </p>
      )}
    </details>
  );
}

export function CreditsScreen({ onBack }: CreditsScreenProps) {
  const resources = useCreditsResources();
  const model = assembleCredits(resources);

  return (
    <main
      className="night-shell night-shell--overlay"
      aria-labelledby="credits-title"
      {...localeTextAttributes()}
    >
      <NightCircuitScene quiet />
      <section className="night-settings credits-screen">
        <header>
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {formatMessage("common.back")}
          </button>
          <p className="night-section-label">{formatMessage("credits.eyebrow")}</p>
          <h1 id="credits-title">{formatMessage("credits.title")}</h1>
        </header>

        {model.sections.map((section) => (
          <div className="night-settings__group" key={section.id}>
            <h2>{section.title}</h2>
            {section.note ? <p>{section.note}</p> : null}
            {section.id === "music" ? (
              <p className="credits-music-status">{model.musicStatus}</p>
            ) : null}
            {section.versions ? (
              <dl className="credits-versions">
                {section.versions.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {section.documents?.map((doc) => (
              <DocumentBlock key={doc.id} document={doc} />
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}
