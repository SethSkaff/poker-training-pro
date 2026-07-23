import { ArrowRight, FastForward, Spade } from "lucide-react";
import { useEffect, useState } from "react";
import { useResilientAsset } from "../lib/useResilientAsset";
import type { GameSettings } from "../types/poker";

interface RoomFlythroughProps {
  eventName: string;
  modeLabel: string;
  settings: GameSettings;
  onComplete: () => void;
}

export function RoomFlythrough({
  eventName,
  modeLabel,
  settings,
  onComplete,
}: RoomFlythroughProps) {
  const [phase, setPhase] = useState<"loading" | "room" | "seat">("loading");
  const backgroundArt = useResilientAsset(
    "/start-menu-room.png",
    "Championship-room background art",
  );

  useEffect(() => {
    if (settings.reducedMotion) {
      const reducedTimer = window.setTimeout(onComplete, 500);
      return () => window.clearTimeout(reducedTimer);
    }
    const roomTimer = window.setTimeout(() => setPhase("room"), 650);
    const seatTimer = window.setTimeout(() => setPhase("seat"), 2_450);
    const completeTimer = window.setTimeout(onComplete, 4_300);
    return () => {
      window.clearTimeout(roomTimer);
      window.clearTimeout(seatTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete, settings.reducedMotion]);

  return (
    <main
      className={`room-flight room-flight--${phase}`}
      data-background-status={backgroundArt.status}
      aria-labelledby="room-flight-title"
      aria-describedby="room-flight-mode"
    >
      <img
        className="room-flight__background-art"
        src="/start-menu-room.png"
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority="high"
        onLoad={backgroundArt.onLoad}
        onError={backgroundArt.onError}
      />
      <div className="room-flight__venue" aria-hidden="true">
        <div className="venue-marquee">
          <Spade size={20} />
          <span>Poker Training Pro</span>
          <strong>Championship Room</strong>
        </div>
        <div className="venue-lights">
          {Array.from({ length: 8 }).map((_, index) => (
            <i key={index} />
          ))}
        </div>
        <div className="venue-tables">
          {Array.from({ length: 5 }).map((_, tableIndex) => (
            <div className="venue-table" key={tableIndex}>
              <span className="venue-table__felt" />
              {Array.from({ length: 4 }).map((__, playerIndex) => (
                <span
                  className={`venue-guest venue-guest--${playerIndex + 1}`}
                  key={playerIndex}
                >
                  <i />
                  <b />
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="hero-chair">
          <span />
          <i />
        </div>
      </div>

      <header className="room-flight__hud">
        <div>
          <p id="room-flight-mode" className="eyebrow">{modeLabel}</p>
          <h1 id="room-flight-title">{eventName}</h1>
        </div>
        <span className="room-flight__status" aria-hidden="true">
          {phase === "loading"
            ? "Preparing the room"
            : phase === "room"
              ? "Crossing the championship floor"
              : "Taking your seat"}
        </span>
      </header>

      {backgroundArt.notice && (
        <p
          className="asset-fallback-notice asset-fallback-notice--room"
          role="status"
        >
          {backgroundArt.notice}
        </p>
      )}

      <div className="room-flight__route" aria-hidden="true">
        <span className={phase !== "loading" ? "is-complete" : "is-current"}>
          Venue
        </span>
        <i />
        <span className={phase === "room" ? "is-current" : phase === "seat" ? "is-complete" : ""}>
          Table
        </span>
        <i />
        <span className={phase === "seat" ? "is-current" : ""}>Your seat</span>
      </div>

      <button className="room-flight__skip" type="button" onClick={onComplete}>
        {phase === "seat" ? (
          <>
            Sit down <ArrowRight size={17} />
          </>
        ) : (
          <>
            Skip arrival <FastForward size={17} />
          </>
        )}
      </button>
    </main>
  );
}
