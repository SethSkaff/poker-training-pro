# Training scenario review and provenance policy

E15-002 requires "the reviewer-metadata policy decided in writing". This is that
decision. It stands independently of whether runtime scenario *generation* ever
ships, because the failure it guards against — content that carries a plausible
provenance block and no human behind it — is a property of the metadata, not of
where the scenario came from.

## The two fields, and what each actually claims

`RatedTrainingScenario` carries both:

| Field | Claim |
|---|---|
| `source.verificationStatus` | Whether the **poker mathematics** has been checked by someone qualified to check it. |
| `review.status` | Whether **this specific scenario** — wording, difficulty, transfer group, recommended action — has been reviewed and signed off. |

They are not the same claim, and the distinction is the point. An instructional
reviewer can approve how a question is phrased without being in a position to
verify its expected values; a poker-maths reviewer can verify the numbers on
content whose wording has not been through instructional review.

## The rules

1. **`review.status: "approved"` requires a `reviewerId` and a `reviewedAt`.**
   Already enforced. An approval with nobody's name on it is not an approval.

2. **`review.status: "pending"` must not carry a reviewer or a date.** Already
   enforced. Half-filled metadata reads as sign-off at a glance.

3. **`source.verificationStatus: "verified"` requires `review.status:
   "approved"`.** Added 2026-07-26. Both fields were validated in isolation, so
   a scenario could claim verified mathematics while its review was still
   pending — a claim of human sign-off with no human attached. This is the
   default state a generator would produce.

4. **The rule in (3) runs one way only.** An approved review may sit alongside
   `pending-human-review` provenance, for the reason given above: approving the
   wording does not verify the arithmetic.

5. **Nothing in the codebase may set either field to its signed-off value.**
   Approval is a human act recorded by a human. No script, generator, or
   migration promotes `pending` to `approved`, or `pending-human-review` to
   `verified`. If a future authoring tool writes these fields, it writes them
   from input a person supplied, and the `reviewerId` identifies that person.

## Current honest state

All twelve authored scenarios are `review.status: "pending"` and
`source.verificationStatus: "pending-human-review"`, with the note "Requires
independent poker-math and instructional review before release."

That is accurate, not a gap in the data. Qualified poker-math review and a
consented human pilot are gated on external experts under E26-001, and the
calibration benchmark is labelled synthetic-only until they happen. The
correct action is to leave the metadata truthful, not to promote it.

## If generation ships

The scope decision recorded in E15-002 defers runtime generation as a product
call. If it lands, this policy binds it:

- Generated scenarios are `review.status: "pending"` and
  `source.verificationStatus: "pending-human-review"` on creation, without
  exception. Rule (5) is what makes that non-negotiable.
- A generator satisfies the *shape* of the metadata trivially. It cannot
  satisfy the claim. Any surface that presents generated content as reviewed —
  a badge, a filter, a "verified" label — is reading the field for a claim the
  field is not making.
- Generated scenarios must persist **verbatim** in the checkpoint rather than
  being regenerated from a seed on load, or a replay shows a different hand
  than the one that was played. The checkpoint stores only a `scenarioId`
  today, which is correct for a fixed bank and insufficient for a generated one.
