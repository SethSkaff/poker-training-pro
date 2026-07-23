import { useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { NightCircuitScene } from "./Dashboard";

interface TitleScreenProps {
  muted: boolean;
  onEnter: () => void;
  onToggleMute: () => void;
}

export function TitleScreen({
  muted,
  onEnter,
  onToggleMute,
}: TitleScreenProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") return;
      onEnter();
    };
    window.addEventListener("keydown", handleKeyDown, { once: true });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEnter]);

  return (
    <main
      className="night-title"
      aria-label="Poker Training Pro title screen"
      onClick={onEnter}
    >
      <NightCircuitScene />
      <button
        className="title-sound"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleMute();
        }}
        aria-label={muted ? "Unmute music" : "Mute music"}
      >
        {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
      </button>

      <section className="title-identity">
        <img src="/poker-training-pro-mark.png" alt="" />
        <h1>Poker Training Pro</h1>
        <p>Press any key</p>
      </section>

      <small className="title-legal">Play chips only · No real-money wagering</small>
    </main>
  );
}
