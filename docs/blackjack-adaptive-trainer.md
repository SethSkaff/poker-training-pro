# Adaptive blackjack trainer

The trainer builds decisions from legal two- and three-card combinations and dealer upcards. Each turn randomly samples a hand composition and integer true count from −6 through +8. It uses the existing six-deck S17, DAS, late-surrender, Hi-Lo strategy engine for grading. There is no fixed puzzle sequence or authored scenario bank.

The previous ten **presented** decisions are excluded, including across mode changes and app restarts when local storage is available. A decision means player total/type (hard, soft, or pair) plus dealer value. Changing suits, composition, count or action availability does not bypass that exclusion. All insurance questions share one identity. Selection never relaxes this guard.

New players start at 900 ELO. The action-question mix interpolates smoothly between these targets:

| Lesson | 900 ELO and below | 1800 ELO and above |
| --- | ---: | ---: |
| Basic strategy unchanged across the supported counts | 66% | 20% |
| Count-sensitive hand, count preserves basic strategy | 22% | 38% |
| Count changes the basic-strategy answer | 12% | 42% |

These are sampling weights, not quotas or a scheduled pattern. Insurance is sampled separately with a 6% chance when its repeat guard permits it. Beginners receive extra weight on TC 0 and small counts. Advanced players receive more tests immediately on either side of an action threshold. Both positive and negative counts appear with unchanged basic strategy and actual deviations. Three-card hands become more common with rating, using the engine's legal hit/stand actions instead of arbitrarily disabling surrender or doubling on ordinary two-card hands.

Question difficulty depends on hand type, count sensitivity, threshold proximity and legal-action restrictions. ELO uses expected score against that difficulty, K=40 for the first 30 answers and K=24 afterward, bounded to 400–2400. The first valid answer is final; duplicate submissions cannot award extra rating. These difficulty ratings are initial design estimates, not population-calibrated ratings.

ELO, answer totals and the recent decision identities are stored under `poker-training-pro:blackjack-trainer:v1` in local storage, independently of Poker's ratings and save-backup format. If storage is blocked, progress survives mode changes in memory and the UI reports that only session storage is available. The current unanswered question is not resumed after leaving the trainer, but remains in the exclusion history.

Regression coverage: `src/blackjack/trainer.test.ts` checks long-run repeat exclusion, session reloads, legal hands, all answer types, constant random sources, beginner/advanced distributions, both signs and both sides of thresholds, idempotent ELO updates and unavailable/corrupt storage. `src/blackjack/engine.test.ts` covers grading, including the three-card soft-18 stand fallback.
