/**
 * Procedural surface textures for the table and the room.
 *
 * Flat Lambert colours got the composition right and the *material* wrong:
 * a single unbroken green is billiard-table plastic, not baize. Real felt has a
 * visible weave and a slight bloom of wear toward the middle, and a card-room
 * carpet is patterned precisely so that a large dark floor still reads as a
 * surface. Neither needs an image file — both are cheap to draw once into a
 * canvas at load, and drawing them here keeps the scene free of any asset to
 * license and anything to fetch at runtime.
 *
 * Everything is generated from a seeded PRNG rather than `Math.random`, so two
 * runs of the packaged audit produce byte-identical textures and a screenshot
 * diff means a real change.
 */

/** Tile size for every surface texture; see `feltTextureBytes`. */
export const SURFACE_TEXTURE_SIZE = 256;

/** Mulberry32. Small, fast, and deterministic from an integer seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function surfaceTextureBytes(): number {
  return SURFACE_TEXTURE_SIZE * SURFACE_TEXTURE_SIZE * 4;
}

/**
 * Baize: a tight two-directional weave over a base green.
 *
 * The weave is drawn as single-pixel warp and weft strokes at alternating
 * opacity rather than as per-pixel noise. Noise reads as film grain and swims
 * when the camera moves; a weave has direction, so it reads as cloth and holds
 * still.
 */
export function drawFeltTexture(
  context: CanvasRenderingContext2D,
  base: string,
  seed = 0x51ed,
): void {
  const size = SURFACE_TEXTURE_SIZE;
  const random = seededRandom(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  /*
    A weave you can actually see.

    The first version drew threads every 2 px at 2-5% alpha. Both halves of that
    were wrong at once: at the tiling this is used at, a 2 px thread lands well
    inside a single screen pixel, so the whole weave averaged back to the flat
    fill it was drawn over -- and even resolved, 2% alpha is below what survives
    tone mapping. The table read as painted plastic, which is exactly what the
    texture exists to prevent. Coarser threads at real contrast, and the caller
    tiles it larger, so a thread is a couple of pixels on screen instead of a
    fifth of one.
  */
  context.lineWidth = 2;
  for (let x = 0; x < size; x += 5) {
    context.strokeStyle = `rgba(255,255,255,${0.075 + random() * 0.05})`;
    context.beginPath();
    context.moveTo(x + 1, 0);
    context.lineTo(x + 1, size);
    context.stroke();
  }
  for (let y = 0; y < size; y += 5) {
    context.strokeStyle = `rgba(0,0,0,${0.11 + random() * 0.07})`;
    context.beginPath();
    context.moveTo(0, y + 1);
    context.lineTo(size, y + 1);
    context.stroke();
  }
  // A scatter of slightly lighter flecks: baize is a pressed wool, never a
  // perfectly even dye, and the flecks are what stop a large area of it from
  // looking like painted card.
  for (let index = 0; index < 1400; index += 1) {
    context.fillStyle = `rgba(255,255,255,${random() * 0.13})`;
    context.fillRect(random() * size, random() * size, 2, 2);
  }
}

/**
 * Card-room carpet: a dense figured pattern in two close tones.
 *
 * Deliberately busy and deliberately low-contrast. Casino carpet is loud in
 * hue and quiet in value, which is why it hides wear and why a big expanse of
 * it never reads as a void the way a flat dark plane does.
 */
export function drawCarpetTexture(
  context: CanvasRenderingContext2D,
  base: string,
  figure: string,
  accent: string,
  seed = 0xc4a7,
): void {
  const size = SURFACE_TEXTURE_SIZE;
  const random = seededRandom(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  // A diamond lattice, drawn tiling so the repeat has no visible seam.
  const cell = size / 4;
  context.strokeStyle = figure;
  context.lineWidth = 2;
  for (let row = -1; row <= 4; row += 1) {
    for (let column = -1; column <= 4; column += 1) {
      const cx = column * cell + cell / 2;
      const cy = row * cell + cell / 2;
      context.beginPath();
      context.moveTo(cx, cy - cell * 0.42);
      context.lineTo(cx + cell * 0.42, cy);
      context.lineTo(cx, cy + cell * 0.42);
      context.lineTo(cx - cell * 0.42, cy);
      context.closePath();
      context.stroke();
      context.fillStyle = accent;
      context.beginPath();
      context.arc(cx, cy, cell * 0.10, 0, Math.PI * 2);
      context.fill();
    }
  }
  for (let index = 0; index < 1400; index += 1) {
    context.fillStyle = `rgba(0,0,0,${random() * 0.10})`;
    context.fillRect(random() * size, random() * size, 1, 1);
  }
}

/**
 * Panelled wall: vertical timber bays with a chair rail.
 *
 * The room's walls were unlit flat planes, which is correct for a background
 * that must never compete with the felt but reads as a painted backdrop at a
 * metre and a half. Panelling gives the eye a repeat to measure the room by.
 */
export function drawWallTexture(
  context: CanvasRenderingContext2D,
  base: string,
  panel: string,
  trim: string,
  seed = 0x9a17,
): void {
  const size = SURFACE_TEXTURE_SIZE;
  const random = seededRandom(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  const bay = size / 4;
  for (let index = 0; index < 4; index += 1) {
    const x = index * bay;
    context.fillStyle = panel;
    context.fillRect(x + bay * 0.12, size * 0.10, bay * 0.76, size * 0.62);
    context.strokeStyle = trim;
    context.lineWidth = 2;
    context.strokeRect(x + bay * 0.12, size * 0.10, bay * 0.76, size * 0.62);
  }
  // Chair rail and skirting, the two horizontals that make a wall read as a
  // wall rather than as a column of rectangles.
  context.fillStyle = trim;
  context.fillRect(0, size * 0.755, size, 3);
  context.fillRect(0, size * 0.955, size, 4);
  for (let index = 0; index < 700; index += 1) {
    context.fillStyle = `rgba(0,0,0,${random() * 0.12})`;
    context.fillRect(random() * size, random() * size, 1, 1);
  }
}
