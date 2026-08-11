# Training content expansion

The runtime supports independently rated decision/math difficulty, source and
review metadata, deterministic adaptive selection, and an exact 50-scenario
no-repeat window whenever a fresh candidate exists. The current curated bank is
small and every entry is still marked `pending-human-review`; it must not be
presented as a verified 100-scenario library.

To reach the product target safely:

1. Author scenarios against the existing schema with one concise numeric poker
   question, action EVs, independent decision/math Elo, source provenance, and
   review metadata. Names/descriptions remain authoring-only and are not shown
   during play.
2. Have a qualified reviewer independently verify card legality, pot/action
   arithmetic, answer/tolerance, EV ordering, and pedagogical value before
   changing `source.status` to `verified`.
3. Build a balanced verified bank of roughly 100 across streets, positions,
   stack depths, actions, math topics, and difficulty. Beginner entries should
   have clear signals; advanced entries should be close but meaningful spots.
4. Add randomized generation only from reviewed templates with invariant and
   solver checks. Generated instances need stable IDs/fingerprints so the same
   spot cannot bypass the prior-50 exclusion through cosmetic number changes.

When fewer than 51 eligible items exist, selection falls back after exhaustion
rather than deadlocking. With the intended 100+ verified bank, exact repeats in
the prior 50 remain a hard exclusion.
