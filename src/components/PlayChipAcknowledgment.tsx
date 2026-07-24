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
    <main className="startup-gate" aria-labelledby="play-chip-ack-title">
      <section className="startup-gate__panel">
        <p className="startup-gate__eyebrow">Before you play</p>
        <h1 id="play-chip-ack-title">These are play chips</h1>
        <p>
          Poker Training Pro is a poker trainer. Play chips only. Chips have no
          cash value, and there is no real-money wagering, no deposits, no
          purchases, and no withdrawals. There is nothing to win or lose but
          practice.
        </p>
        <p>
          This message appears once. You can revisit the details any time from
          Settings.
        </p>
        <div className="startup-gate__actions">
          <button type="button" autoFocus onClick={onAcknowledge}>
            I understand — continue
          </button>
          <button type="button" onClick={onBack}>
            Back to menu
          </button>
        </div>
      </section>
    </main>
  );
}
