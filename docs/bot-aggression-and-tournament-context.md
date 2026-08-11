# Bot aggression and tournament-context basis

The Normal bot uses the same public-information EV baseline as Rational mode,
then applies only bounded personality deviations. It is a heuristic model, not
a solver and not a claim of GTO play.

## Strategy sources consulted

- Jonathan Little, PokerCoaching, [Facing a Bet – A Guide to Making Optimal
  Decisions](https://pokercoaching.com/blog/a-guide-to-making-optimal-decisions-when-facing-a-bet/):
  large bets require tighter continuing ranges; strong value and high-equity
  draws can raise, while medium-strength hands usually call or fold; board
  texture and range advantage matter.
- Jonathan Little, PokerCoaching, [Facing Major Aggression With a Strong Top
  Pair](https://pokercoaching.com/blog/facing-major-aggression-with-a-strong-top-pair/):
  reraising a medium-strength value hand can fold out worse hands and isolate
  against better ones, while calling can retain bluffs and control the pot.
- PokerCoaching, [LAG Poker Strategy](https://pokercoaching.com/blog/lag-poker/):
  an aggressor's wide bluff component can be exploited by letting them keep
  betting; vulnerable strong hands should raise more often than locked-up
  strong hands.
- Upswing Poker, [Polarized vs Linear Ranges](https://upswingpoker.com/polarized-vs-linear-ranges/):
  larger sizes are commonly associated with polarized ranges, and medium
  strength should not be treated like the top of range.
- GTO Wizard, [Facing 3-Bets From Covering Stacks at the Final
  Table](https://blog.gtowizard.com/facing-3-bets-from-covering-stacks-at-the-final-table/):
  tournament stack depth and coverage change responses to aggression; even
  short stacks retain disciplined fold/call branches rather than shoving every
  nominally playable hand.

## Bounded implementation

The evaluator measures public bet size/pot odds, current-street aggression,
estimated range equity, position, draw/board volatility, effective stack, and
tournament survival pressure. Against large repeated aggression it gives a
small value bonus to robust hands: dry-board strength favors calling to retain
bluffs, while vulnerable/dynamic-board strength favors raising. Marginal hands
receive no bonus and aggressive continuations below the risk-adjusted equity
threshold receive an explicit penalty. All adjustments are bounded below one
big blind and cannot inspect hidden cards.

Tournament context separates survival risk from blind urgency. Bubble/hand-for-
hand pressure raises the equity threshold; a genuinely short stack—especially
one posting the next big blind—reduces excessive survival folding and adds only
a bounded, equity-gated preflop urgency adjustment. It does not label every
short-stack shove as good.
