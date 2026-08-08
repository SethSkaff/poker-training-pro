/**
 * Presentation constants for the in-world pot readout.  Keep this separate
 * from the scene loop so the visual contract is small, explicit, and testable.
 */
export const POT_HOLOGRAM = {
  /** Thin enough to read as projected light rather than a physical cord. */
  beamRadius: 0.0018,
  /** The label clears the chips and board without covering either. */
  labelHeight: 0.34,
  /** The beam starts at the pile origin, never at a card or side rail. */
  beamStartHeight: 0.018,
  labelSize: [0.19, 0.05] as const,
} as const;

export function potHologramLabel(kind: "main" | "side", amount: number): string {
  const prefix = kind === "main" ? "POT" : "SIDE";
  if (amount >= 10_000) return `${prefix} ${(amount / 1_000).toFixed(amount % 1_000 === 0 ? 0 : 1)}K`;
  if (amount >= 1_000) return `${prefix} ${(amount / 1_000).toFixed(1)}K`;
  return `${prefix} ${Math.max(0, Math.round(amount))}`;
}
