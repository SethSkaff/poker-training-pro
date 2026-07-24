import { formatMessage, localeTextAttributes } from "../lib/localeMessages";

interface PlayChipAcknowledgmentProps {
  onAcknowledge: () => void;
  onBack: () => void;
}

/**
 * One-time interactive play-chip disclosure shown before the first play session.
 * The wording reuses the approved no-value phrases ("Play chips only", "no cash
 * value", "No real-money wagering") so it stays consistent with the static start
 * menu copy and the play-chip boundary audit.
 */
export function PlayChipAcknowledgment({
  onAcknowledge,
  onBack,
}: PlayChipAcknowledgmentProps) {
  return (
    <main
      className="startup-gate"
      aria-labelledby="play-chip-ack-title"
      {...localeTextAttributes()}
    >
      <section className="startup-gate__panel">
        <p className="startup-gate__eyebrow">{formatMessage("playChipAck.eyebrow")}</p>
        <h1 id="play-chip-ack-title">{formatMessage("playChipAck.title")}</h1>
        <p>{formatMessage("playChipAck.body")}</p>
        <p>{formatMessage("playChipAck.followUp")}</p>
        <div className="startup-gate__actions">
          <button type="button" autoFocus onClick={onAcknowledge}>
            {formatMessage("playChipAck.acknowledgeButton")}
          </button>
          <button type="button" onClick={onBack}>
            {formatMessage("playChipAck.backButton")}
          </button>
        </div>
      </section>
    </main>
  );
}
