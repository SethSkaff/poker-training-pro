/**
 * What the hero's primary "call" control should say (E27-005).
 *
 * The engine is right and the button was wrong: the legal action really is a
 * call, and it really is for `amountToCall` -- but when the hero cannot cover
 * that amount the chips that actually leave their stack are all of them, and
 * the button said "Call 4,000" while committing 1,200 and creating a side pot.
 * A player reading that label cannot tell they are about to be all in.
 *
 * This is deliberately a pure function of two numbers, separate from
 * legal-action calculation. The two were entangled in the component, so a
 * correct engine masked a lying button and no test could see the difference.
 */
export type CallActionKind = "check" | "call" | "all-in";

export interface CallActionDescription {
  /** Which label the control should render. */
  readonly kind: CallActionKind;
  /** Chips that actually leave the hero's stack. Zero for a check. */
  readonly committed: number;
  /**
   * The outstanding bet the hero is facing, whether or not they can cover it.
   * Kept so the interface can say "all in for 1,200" against a 4,000 bet
   * without pretending the hero matched it.
   */
  readonly facing: number;
  /** True when the hero cannot cover the outstanding bet, so a side pot forms. */
  readonly shortOfCall: boolean;
}

export function describeCallAction({
  amountToCall,
  heroStack,
}: {
  readonly amountToCall: number;
  readonly heroStack: number;
}): CallActionDescription {
  const facing = Math.max(0, amountToCall);
  const stack = Math.max(0, heroStack);

  if (facing === 0) {
    return { kind: "check", committed: 0, facing: 0, shortOfCall: false };
  }

  // Calling costs the hero the smaller of the two: a player never puts in more
  // than they have, and never more than the bet they are facing.
  const committed = Math.min(facing, stack);
  // Equal counts as all-in: committing the last chip is being all in, and the
  // exact-cover case is the one a player is most likely to misread.
  const commitsEverything = stack > 0 && committed >= stack;

  return {
    kind: commitsEverything ? "all-in" : "call",
    committed,
    facing,
    shortOfCall: facing > stack,
  };
}
