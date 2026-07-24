import Foundation

// Typed, on-device operations over the shared engine bundle. Every gameplay,
// grading, timing, and bot-math request stays inside JavaScriptCore in the app
// process — no server, network, or account is involved.

struct DecisionTimingInput {
    var seed: String
    var decisionId: String
    var street: String
    var action: String
    var cutoffCloseness: Double = 0
    var uncertainty: Double = 0
    var tempo: Double = 0
    /// User speed preference, 0.5x to 3x. Mobile animation budgets are shorter.
    var presentationRate: Double = 1
    var surface: String = "mobile"
}

struct TrainingGradeInput {
    var action: String
    var mathInput: String
    var unit: String
    var correctValue: Double
    var tolerance: Double
    var mathExplanation: String
    var actionEvs: [String: Double]
    var actionEpsilon: Double
    var partialCreditRegret: Double
    var acceptableActions: [String]
    var actionReason: String
    var decisionElo: Int
    var mathElo: Int
    var decisionDifficulty: Int
    var mathDifficulty: Int
    var decisionAttempts: Int
    var mathAttempts: Int
    var actionElapsedMs: Int
    var mathElapsedMs: Int
    var targetDecisionMs: Int
    var targetMathMs: Int
}

struct BotDecisionInput {
    var style: String
    var hero: [PokerCard]
    var board: [PokerCard]
    var opponents: Int
    var pot: Int
    var toCall: Int
    var bigBlind: Int
    var effectiveStack: Int = 0
    var legalRaiseTo: Int?
    var seed: String
    /// Optional per-decision simulation cap. The engine clamps to the phone
    /// ceiling regardless, so a caller can only make decisions cheaper.
    var simulations: Int?
}

struct TimedBlindInput {
    var durationMinutes: Int
    var elapsedMs: Int
    var current: TimedBlindLevel
    var players: [(id: String, stack: Int, eliminated: Bool)]
    var startingTotalChips: Int
}

extension SharedPokerEngineBridge {
    private func decode<T: Decodable>(_ response: EngineResponse) throws -> T {
        guard let result = response.result else {
            throw EngineBridgeError.invalidResponse
        }
        let data = try JSONEncoder().encode(result)
        return try JSONDecoder().decode(T.self, from: data)
    }

    func health() throws -> EngineHealth {
        try decode(try invoke(EngineRequest(operation: "health")))
    }

    func evaluateHand(_ cards: [PokerCard]) throws -> HandValueResult {
        try decode(try invoke(EngineRequest(
            operation: "evaluateHand",
            payload: ["cards": .cards(cards)]
        )))
    }

    func parseMathAnswer(_ input: String, unit: String) throws -> Double? {
        let result: MathAnswerResult = try decode(try invoke(EngineRequest(
            operation: "parseMathAnswer",
            payload: ["input": .string(input), "unit": .string(unit)]
        )))
        return result.value
    }

    func decisionTiming(_ input: DecisionTimingInput) throws -> DecisionTimingResult {
        try decode(try invoke(EngineRequest(
            operation: "decisionTiming",
            payload: [
                "seed": .string(input.seed),
                "decisionId": .string(input.decisionId),
                "street": .string(input.street),
                "action": .string(input.action),
                "cutoffCloseness": .init(input.cutoffCloseness),
                "uncertainty": .init(input.uncertainty),
                "tempo": .init(input.tempo),
                "presentationRate": .init(input.presentationRate),
                "surface": .string(input.surface),
            ]
        )))
    }

    func gradeTraining(_ input: TrainingGradeInput) throws -> TrainingGrade {
        var evs: [String: JSONValue] = [:]
        for (key, value) in input.actionEvs { evs[key] = .init(value) }
        return try decode(try invoke(EngineRequest(
            operation: "gradeTraining",
            payload: [
                "action": .string(input.action),
                "mathInput": .string(input.mathInput),
                "unit": .string(input.unit),
                "correctValue": .init(input.correctValue),
                "tolerance": .init(input.tolerance),
                "mathExplanation": .string(input.mathExplanation),
                "actionEvs": .object(evs),
                "actionEpsilon": .init(input.actionEpsilon),
                "partialCreditRegret": .init(input.partialCreditRegret),
                "acceptableActions": .array(input.acceptableActions.map { .string($0) }),
                "actionReason": .string(input.actionReason),
                "decisionElo": .init(input.decisionElo),
                "mathElo": .init(input.mathElo),
                "decisionDifficulty": .init(input.decisionDifficulty),
                "mathDifficulty": .init(input.mathDifficulty),
                "decisionAttempts": .init(input.decisionAttempts),
                "mathAttempts": .init(input.mathAttempts),
                "actionElapsedMs": .init(input.actionElapsedMs),
                "mathElapsedMs": .init(input.mathElapsedMs),
                "targetDecisionMs": .init(input.targetDecisionMs),
                "targetMathMs": .init(input.targetMathMs),
            ]
        )))
    }

    func botDecision(_ input: BotDecisionInput) throws -> BotDecisionResult {
        var payload: [String: JSONValue] = [
            "style": .string(input.style),
            "hero": .cards(input.hero),
            "board": .cards(input.board),
            "opponents": .init(input.opponents),
            "pot": .init(input.pot),
            "toCall": .init(input.toCall),
            "bigBlind": .init(input.bigBlind),
            "effectiveStack": .init(input.effectiveStack),
            "seed": .string(input.seed),
        ]
        if let raiseTo = input.legalRaiseTo {
            payload["legalRaiseTo"] = .init(raiseTo)
        }
        if let simulations = input.simulations {
            payload["simulations"] = .init(simulations)
        }
        return try decode(try invoke(EngineRequest(operation: "botDecision", payload: payload)))
    }

    func estimateEquity(
        hero: [PokerCard],
        board: [PokerCard],
        opponents: Int,
        seed: String,
        simulations: Int? = nil
    ) throws -> EquityEstimate {
        var payload: [String: JSONValue] = [
            "hero": .cards(hero),
            "board": .cards(board),
            "opponents": .init(opponents),
        ]
        if let simulations {
            payload["simulations"] = .init(simulations)
        }
        return try decode(try invoke(EngineRequest(
            operation: "estimateEquity",
            seed: seed,
            payload: payload
        )))
    }

    func timedBlinds(_ input: TimedBlindInput) throws -> TimedBlindDecision {
        let players: [JSONValue] = input.players.map { player in
            .object([
                "id": .string(player.id),
                "stack": .init(player.stack),
                "eliminated": .init(player.eliminated),
            ])
        }
        return try decode(try invoke(EngineRequest(
            operation: "timedBlinds",
            payload: [
                "durationMinutes": .init(input.durationMinutes),
                "elapsedMs": .init(input.elapsedMs),
                "current": .object([
                    "smallBlind": .init(input.current.smallBlind),
                    "bigBlind": .init(input.current.bigBlind),
                    "bigBlindAnte": .init(input.current.bigBlindAnte),
                ]),
                "players": .array(players),
                "startingTotalChips": .init(input.startingTotalChips),
            ]
        )))
    }
}
