/**
 * How tall a seat's chip stack should look (E27-009).
 *
 * Seats used to carry one chip glyph beside a number, so the only way to learn
 * that a player was short was to read their stack and divide by the blind. The
 * chips said nothing.
 *
 * Height is measured in **big blinds**, not chips, because that is what "short"
 * means at a tournament table: 15,000 is a deep stack at 25/50 and a desperate
 * one at 1,000/2,000, and a pile sized by raw chips would look identical in
 * both. Sizing by blinds means the stacks visibly shrink as the level climbs
 * even when nobody has lost a chip -- which is exactly the pressure the player
 * should feel.
 */

/** The tallest pile drawn. Beyond this, extra chips add no information. */
export const MAX_SEAT_CHIPS = 12;

/**
 * Big-blind thresholds at which another chip is added. Chosen so the shape of
 * a tournament is legible: sub-10bb piles are visibly stubby, the 20-40bb band
 * where most decisions happen has room to differ, and very deep stacks stop
 * growing rather than towering over the table.
 */
const BIG_BLIND_THRESHOLDS = [
  1, 3, 6, 10, 15, 20, 30, 40, 60, 90, 130, 180,
] as const;

export function seatChipStackCount(
  stack: number,
  bigBlind: number,
): number {
  if (!Number.isFinite(stack) || stack <= 0) return 0;
  // Without a usable blind, fall back to showing a single chip rather than
  // inventing a depth the player cannot verify.
  if (!Number.isFinite(bigBlind) || bigBlind <= 0) return 1;

  const bigBlinds = stack / bigBlind;
  let chips = 0;
  for (const threshold of BIG_BLIND_THRESHOLDS) {
    if (bigBlinds >= threshold) chips += 1;
  }
  return Math.min(MAX_SEAT_CHIPS, Math.max(1, chips));
}

/**
 * A short stack is one the table should be able to see is short.
 *
 * Ten big blinds is the conventional shove-or-fold boundary, and it is the
 * point at which the pile should read as visibly stubby rather than merely
 * smaller than its neighbours.
 */
export function isShortStack(stack: number, bigBlind: number): boolean {
  if (!Number.isFinite(bigBlind) || bigBlind <= 0) return false;
  if (!Number.isFinite(stack) || stack <= 0) return false;
  return stack / bigBlind < 10;
}
