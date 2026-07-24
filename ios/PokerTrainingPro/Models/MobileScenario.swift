import Foundation

/// A compact, on-device Training scenario. The grading parameters mirror the
/// shared TypeScript training bank (`src/data/trainingScenarios.ts`) exactly so
/// the bundled engine grades the same way the desktop does. This bundled subset
/// keeps the scaffold self-contained; the production build should export the
/// full validated bank rather than hand-maintaining it here.
struct MobileScenario: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let prompt: String
    let heroCards: [PokerCard]
    let board: [PokerCard]
    let availableActions: [String]
    let recommendedAction: String
    let actionReason: String
    let actionEvs: [String: Double]
    let actionEpsilon: Double
    let partialCreditRegret: Double
    let acceptableActions: [String]
    let decisionDifficulty: Int
    let mathDifficulty: Int
    let targetDecisionMs: Int
    let targetMathMs: Int

    let mathPrompt: String
    let mathUnit: String
    let correctValue: Double
    let tolerance: Double
    let mathExplanation: String

    static let bank: [MobileScenario] = [
        MobileScenario(
            id: "preflop-pot-odds-ak",
            title: "Big Slick at a short table",
            prompt: "The small blind shoves and the action returns to you in the big blind. Against the shown 22–QQ, AJs+, AQo+ range, what is your decision?",
            heroCards: [PokerCard(rank: "A", suit: "spades"), PokerCard(rank: "K", suit: "hearts")],
            board: [],
            availableActions: ["fold", "call"],
            recommendedAction: "call",
            actionReason: "Calling needs 40% equity. AKo has about 46% against the stated range, making the call profitable in chip EV.",
            actionEvs: ["fold": 0, "call": 1.35],
            actionEpsilon: 0.05,
            partialCreditRegret: 0.4,
            acceptableActions: [],
            decisionDifficulty: 1040,
            mathDifficulty: 980,
            targetDecisionMs: 18_000,
            targetMathMs: 20_000,
            mathPrompt: "What equity percentage is required to call 1,800 into a final pot of 4,500?",
            mathUnit: "%",
            correctValue: 40,
            tolerance: 1.5,
            mathExplanation: "Required equity = 1,800 / (2,700 + 1,800) = 40%."
        ),
        MobileScenario(
            id: "preflop-button-shove-fold-equity",
            title: "Button pressure",
            prompt: "It folds to you on the button with 11 big blinds. The blinds fold often enough that a shove is profitable. Choose your action.",
            heroCards: [PokerCard(rank: "A", suit: "diamonds"), PokerCard(rank: "5", suit: "diamonds")],
            board: [],
            availableActions: ["fold", "raise", "all-in"],
            recommendedAction: "all-in",
            actionReason: "A5 suited combines an ace blocker with usable equity when called. At 11bb, the modeled shove gains more than a small raise or fold.",
            actionEvs: ["fold": 0, "raise": 0.18, "all-in": 0.62],
            actionEpsilon: 0.06,
            partialCreditRegret: 0.5,
            acceptableActions: [],
            decisionDifficulty: 1210,
            mathDifficulty: 1180,
            targetDecisionMs: 16_000,
            targetMathMs: 28_000,
            mathPrompt: "Ignoring showdown equity, what fold percentage would a risk of 11,000 need to win the current 2,625 pot?",
            mathUnit: "%",
            correctValue: 80.73,
            tolerance: 1.5,
            mathExplanation: "Pure-bluff break-even frequency = 11,000 / (11,000 + 2,625) = 80.73%."
        ),
        MobileScenario(
            id: "preflop-implied-odds-pair",
            title: "Set-mining price",
            prompt: "A tight early-position player opens to 800 and you close the action in the big blind with 14,400 behind. Choose your action.",
            heroCards: [PokerCard(rank: "7", suit: "clubs"), PokerCard(rank: "7", suit: "spades")],
            board: [],
            availableActions: ["fold", "call", "raise"],
            recommendedAction: "call",
            actionReason: "The direct price plus deep effective stacks support a call. The tight opener can pay enough often when you flop a set.",
            actionEvs: ["fold": 0, "call": 0.34, "raise": -0.22],
            actionEpsilon: 0.05,
            partialCreditRegret: 0.4,
            acceptableActions: [],
            decisionDifficulty: 1260,
            mathDifficulty: 1300,
            targetDecisionMs: 22_000,
            targetMathMs: 32_000,
            mathPrompt: "Using the 12-to-1 set-mining guideline, how many additional chips beyond the current 1,700 final pot must you expect to win to justify the 600 call?",
            mathUnit: "chips",
            correctValue: 5500,
            tolerance: 300,
            mathExplanation: "A 12-to-1 target requires about 7,200 total for a 600 call. The final pot is 1,700, leaving roughly 5,500 to win later."
        ),
        MobileScenario(
            id: "flop-flush-draw-all-in",
            title: "Two cards guaranteed",
            prompt: "Your opponent is all-in, so a call guarantees both turn and river. Treat the nine remaining hearts as clean outs. Choose your action.",
            heroCards: [PokerCard(rank: "A", suit: "hearts"), PokerCard(rank: "J", suit: "hearts")],
            board: [PokerCard(rank: "8", suit: "hearts"), PokerCard(rank: "3", suit: "hearts"), PokerCard(rank: "K", suit: "clubs")],
            availableActions: ["fold", "call"],
            recommendedAction: "call",
            actionReason: "The nut-flush draw arrives by the river about 35% of the time, comfortably above the 25% call threshold.",
            actionEvs: ["fold": 0, "call": 2.49],
            actionEpsilon: 0.05,
            partialCreditRegret: 0.45,
            acceptableActions: [],
            decisionDifficulty: 1020,
            mathDifficulty: 1060,
            targetDecisionMs: 16_000,
            targetMathMs: 22_000,
            mathPrompt: "Approximately how often will nine clean outs hit by the river from the flop?",
            mathUnit: "%",
            correctValue: 34.97,
            tolerance: 2,
            mathExplanation: "1 - (38/47 × 37/46) = 34.97%. The Rule of 4 estimate is 36%."
        ),
    ]
}
