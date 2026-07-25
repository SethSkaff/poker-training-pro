# Adaptive Training Difficulty

Training uses two independent ratings. Decision Elo is matched against a
scenario's authored `decisionDifficulty`; Math Elo is matched against its
authored `mathDifficulty`. The selector subtracts the distance from each
rating, then applies the normal history, transfer-topic, action, and street
diversity rules.

At 1100 or below, decision prompts above 1340 and math prompts above 1230 are
excluded. At 1500 or above, introductory decision prompts below 1210 and math
prompts below 1160 are excluded. These are guardrails, not labels: the exact
scenario remains deterministic for the same player progress and bank.

Because the two adjustments are separate, strong hand-reading with developing
math (or the inverse) changes only the corresponding part of selection. The
app passes both persisted ratings when it starts and advances a Training
session. Ratings update after each graded attempt, so a run of misses naturally
brings the next prompt closer to the player's current level.
