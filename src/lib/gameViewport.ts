export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/** One camera fit. Neither aspect ratio nor device pixel ratio changes geometry. */
export function fitGameViewport(width: number, height: number) {
  const scale = Math.max(0, Math.min(width / GAME_WIDTH, height / GAME_HEIGHT));
  return {
    scale,
    left: (width - GAME_WIDTH * scale) / 2,
    top: (height - GAME_HEIGHT * scale) / 2,
  };
}

export function clientToGamePoint(
  x: number,
  y: number,
  bounds: { left: number; top: number; width: number },
) {
  const scale = bounds.width / GAME_WIDTH || 1;
  return { x: (x - bounds.left) / scale, y: (y - bounds.top) / scale };
}

/** Native hit testing already accounts for transforms; only gesture distances
 * need conversion. Keep the existing compact/3D gesture coordinates unchanged. */
export function gamePointerPoint(element: HTMLElement, x: number, y: number) {
  const frame = element.closest<HTMLElement>(".desktop-game-frame");
  return frame ? clientToGamePoint(x, y, frame.getBoundingClientRect()) : { x, y };
}
