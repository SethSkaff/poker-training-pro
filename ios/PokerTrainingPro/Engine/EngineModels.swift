import Foundation

// Typed results decoded from the shared engine bundle. Each mirrors a result
// object documented in docs/ios/engine-bridge-contract.md and produced by
// `ios/PokerTrainingPro/Resources/Engine/poker-engine.js`.

struct EngineHealth: Codable, Equatable, Sendable {
    let deterministic: Bool
    let engineVersion: String
    let contractVersion: String
    let operations: [String]
    let equityCaps: EquityCaps

    struct EquityCaps: Codable, Equatable, Sendable {
        let defaultSimulations: Int
        let maximumSimulations: Int
        let defaultSimulationsPerSlice: Int
        let maximumSimulationsPerSlice: Int
    }
}

struct HandValueResult: Codable, Equatable, Sendable {
    let category: Int
    let categoryName: String
    let displayName: String
    let tiebreak: [Int]
    let cards: [PokerCard]
}

struct MathAnswerResult: Codable, Equatable, Sendable {
    let value: Double?
}

struct DecisionTimingResult: Codable, Equatable, Sendable {
    let delayMs: Double
    let unscaledDelayMs: Double
    let surface: String
    let presentationRate: Double
    let antiTellNoiseMs: Double
    let boundedDifficultyMs: Double

    /// Presentation-only delay in seconds, already scaled by the user speed
    /// preference. Never advance this while the app is inactive/backgrounded.
    var delaySeconds: Double { delayMs / 1000 }
}

struct EquityWork: Codable, Equatable, Sendable {
    let workVersion: String
    let requestedSimulations: Int
    let completedSimulations: Int
    let simulationsPerSlice: Int
    let slices: Int
    let handEvaluations: Int
    let maximumSimulationsPerDecision: Int
    let maximumSimulationsPerSlice: Int
    let schedulingBasis: String
}

struct EquityEstimate: Codable, Equatable, Sendable {
    let equity: Double
    let wins: Int
    let ties: Int
    let losses: Int
    let simulations: Int
    let work: EquityWork
}

struct BotDecisionResult: Codable, Equatable, Sendable {
    let style: String
    let action: String
    let raiseTo: Int?
    let equity: Double
    let potOdds: Double
    let requiredEquity: Double
    let effectiveStackBigBlinds: Double
    let rationale: String
    let work: EquityWork
}

struct ActionGrade: Codable, Equatable, Sendable {
    let action: String
    let bestAction: String
    let bestEv: Double
    let chosenEv: Double?
    let regret: Double?
    let score: Double
    let correct: Bool
    let close: Bool
    let explanation: String
}

struct MathGrade: Codable, Equatable, Sendable {
    let answer: Double?
    let correctValue: Double
    let error: Double?
    let tolerance: Double
    let score: Double
    let correct: Bool
    let close: Bool
    let explanation: String
}

struct TimingGrade: Codable, Equatable, Sendable {
    let actionMs: Double
    let mathMs: Double
    let totalMs: Double
    let actionTargetRatio: Double
    let mathTargetRatio: Double
    let pace: String
    let withinTableClock: Bool
}

struct TrainingGrade: Codable, Equatable, Sendable {
    let action: ActionGrade
    let math: MathGrade
    let timing: TimingGrade
    let decisionEloDelta: Int
    let mathEloDelta: Int
    let decisionEloAfter: Int
    let mathEloAfter: Int
    let eloDelta: Int
    let mathAnswer: Double?
}

struct TimedBlindLevel: Codable, Equatable, Sendable {
    let smallBlind: Int
    let bigBlind: Int
    let bigBlindAnte: Int
}

struct TimedBlindDecision: Codable, Equatable, Sendable {
    let smallBlind: Int
    let bigBlind: Int
    let bigBlindAnte: Int
    let phase: String
    let progress: Double
    let livePlayers: Int
    let nextReviewMs: Double
    let forcedAllInStack: Int?
    let reason: String
}
