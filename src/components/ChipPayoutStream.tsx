import { useLayoutEffect, useRef, useState } from "react";

/** Presentation only: the recipient and amount come from one engine award. */
export function chipStreamFrame(progress: number, stack: number, chip: number) {
  const lift = Math.min(1, progress / 0.18);
  const travel = Math.max(
    0,
    Math.min(1, (progress - 0.18 - stack * 0.012 - chip * 0.018) / 0.61),
  );
  return {
    lift: -12 * lift,
    travel: travel * travel * (3 - 2 * travel),
    opacity: travel > 0.94 ? (1 - travel) / 0.06 : 1,
  };
}
export function ChipPayoutStream({
  playerId,
  amount,
  progress,
  stackCount,
  reducedMotion,
}: {
  playerId: string;
  amount: number;
  progress: number;
  stackCount: number;
  reducedMotion: boolean;
}) {
  const origin = useRef<HTMLSpanElement>(null);
  const [destination, setDestination] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const start = origin.current;
    const stage = start?.closest(".poker-scene");
    const seat = [
      ...(stage?.querySelectorAll<HTMLElement>("[data-scene-player-id]") ?? []),
    ].find((el) => el.dataset.scenePlayerId === playerId);
    const target = seat?.querySelector(".seat-label");
    if (!start || !stage || !target) return;
    const measure = () => {
      const a = start.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const group = start.closest<HTMLElement>(".pot-groups")!;
      const zoom = group.getBoundingClientRect().width / group.offsetWidth;
      setDestination({
        x: (b.x + b.width / 2 - a.x) / zoom,
        y: (b.y + b.height / 2 - a.y) / zoom,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [playerId]);
  return (
    <span
      ref={origin}
      className="chip-payout-stream"
      data-payout-player={playerId}
      data-payout-amount={amount}
      aria-hidden="true"
    >
      {Array.from({ length: stackCount }, (_, stack) =>
        Array.from({ length: 3 }, (_, chip) => {
          const frame = chipStreamFrame(progress, stack, chip);
          const x = (stack - (stackCount - 1) / 2) * 26 - 9;
          return (
            <i
              key={`${stack}-${chip}`}
              style={{
                zIndex: 3 - chip,
                opacity: reducedMotion ? 1 - progress : frame.opacity,
                transform: reducedMotion
                  ? undefined
                  : `translate(${x + (destination.x - x) * frame.travel}px, ${3 + chip * 4 + frame.lift + (destination.y - frame.lift) * frame.travel}px)`,
              }}
            />
          );
        }),
      )}
    </span>
  );
}
