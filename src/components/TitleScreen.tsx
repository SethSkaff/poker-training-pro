import { useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
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
      aria-label={formatMessage("titleScreen.ariaLabel")}
      onClick={onEnter}
      {...localeTextAttributes()}
    >
      <NightCircuitScene />
      <button
        className="title-sound"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleMute();
        }}
        aria-label={formatMessage(
          muted ? "titleScreen.unmuteMusic" : "titleScreen.muteMusic",
        )}
      >
        {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
      </button>

      <section className="title-identity">
        <img src="/poker-training-pro-mark.png" alt="" />
        <h1>{formatMessage("shell.productName")}</h1>
        <p>{formatMessage("titleScreen.pressAnyKey")}</p>
      </section>

      <small className="title-legal">
        {formatMessage("titleScreen.playChipDisclosure")}
      </small>
    </main>
  );
}
