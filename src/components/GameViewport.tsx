import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fitGameViewport, GAME_HEIGHT, GAME_WIDTH } from "../lib/gameViewport";

/** Electron always uses the authored desktop composition, even in a narrow
 * window. The existing <=760px browser UI remains a separate compact layout. */
export function GameViewport({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined"
    && (Boolean(window.desktop) || window.matchMedia("(min-width: 761px)").matches));
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const active = enabled && desktop;

  useLayoutEffect(() => {
    if (window.desktop) return;
    const query = window.matchMedia("(min-width: 761px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const frame = frameRef.current;
    if (!active || !viewport || !frame) return;
    const fit = () => {
      const { scale, left, top } = fitGameViewport(viewport.clientWidth, viewport.clientHeight);
      frame.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [active]);

  return (
    <div ref={viewportRef} className={active ? "desktop-game-viewport" : "game-viewport-pass-through"}>
      <div ref={frameRef} className={active ? "desktop-game-frame" : "game-viewport-pass-through"}
        style={active ? { width: GAME_WIDTH, height: GAME_HEIGHT } : undefined}>
        {children}
      </div>
    </div>
  );
}
