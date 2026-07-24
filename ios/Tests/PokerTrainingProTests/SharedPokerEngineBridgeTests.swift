import XCTest
@testable import PokerTrainingPro

@MainActor
final class SharedPokerEngineBridgeTests: XCTestCase {
    private func mainBridge() throws -> SharedPokerEngineBridge {
        try SharedPokerEngineBridge(bundle: .main)
    }

    func testFixtureDecodesADealPreview() throws {
        let fixture = try XCTUnwrap(
            Bundle(for: Self.self).url(
                forResource: "poker-engine-fixture",
                withExtension: "js"
            )
        )
        let bridge = try SharedPokerEngineBridge(scriptURL: fixture)

        let deal = try bridge.dealPreview(seed: "repeatable")

        XCTAssertEqual(deal.hero.count, 2)
        XCTAssertEqual(deal.board.count, 3)
        XCTAssertEqual(deal.hero.first, PokerCard(rank: "A", suit: "spades"))
    }

    func testBundledEngineIsDeterministic() throws {
        let bridge = try mainBridge()

        let first = try bridge.dealPreview(seed: "same-seed")
        let second = try bridge.dealPreview(seed: "same-seed")

        XCTAssertEqual(first, second)
    }

    func testHealthReportsOperationsAndCaps() throws {
        let health = try mainBridge().health()
        XCTAssertTrue(health.deterministic)
        XCTAssertTrue(health.operations.contains("botDecision"))
        XCTAssertTrue(health.operations.contains("gradeTraining"))
        XCTAssertEqual(health.equityCaps.maximumSimulations, 600)
    }

    func testEvaluatorRecognizesARoyalFlush() throws {
        let royal = [
            PokerCard(rank: "A", suit: "spades"),
            PokerCard(rank: "K", suit: "spades"),
            PokerCard(rank: "Q", suit: "spades"),
            PokerCard(rank: "J", suit: "spades"),
            PokerCard(rank: "T", suit: "spades"),
        ]
        let value = try mainBridge().evaluateHand(royal)
        XCTAssertEqual(value.category, 8)
        XCTAssertEqual(value.displayName, "Royal Flush")
    }

    func testQuizParsingAcceptsTableForms() throws {
        let bridge = try mainBridge()
        XCTAssertEqual(try bridge.parseMathAnswer("2:1", unit: "%"), 33.33333333333333, accuracy: 1e-9)
        XCTAssertEqual(try bridge.parseMathAnswer("1/3", unit: "%"), 33.33333333333333, accuracy: 1e-9)
        XCTAssertEqual(try bridge.parseMathAnswer("0.33", unit: "%"), 33, accuracy: 1e-9)
        XCTAssertEqual(try bridge.parseMathAnswer("40%", unit: "%"), 40, accuracy: 1e-9)
        XCTAssertNil(try bridge.parseMathAnswer("not-a-number", unit: "%"))
        // A percent-marked answer is invalid for a non-percent question.
        XCTAssertNil(try bridge.parseMathAnswer("50%", unit: "chips"))
    }

    func testGradeTrainingScoresACorrectAttempt() throws {
        let scenario = try XCTUnwrap(MobileScenario.bank.first { $0.id == "preflop-pot-odds-ak" })
        let grade = try mainBridge().gradeTraining(TrainingGradeInput(
            action: "call",
            mathInput: "40%",
            unit: scenario.mathUnit,
            correctValue: scenario.correctValue,
            tolerance: scenario.tolerance,
            mathExplanation: scenario.mathExplanation,
            actionEvs: scenario.actionEvs,
            actionEpsilon: scenario.actionEpsilon,
            partialCreditRegret: scenario.partialCreditRegret,
            acceptableActions: scenario.acceptableActions,
            actionReason: scenario.actionReason,
            decisionElo: 1200,
            mathElo: 1200,
            decisionDifficulty: scenario.decisionDifficulty,
            mathDifficulty: scenario.mathDifficulty,
            decisionAttempts: 0,
            mathAttempts: 0,
            actionElapsedMs: 6000,
            mathElapsedMs: 8000,
            targetDecisionMs: scenario.targetDecisionMs,
            targetMathMs: scenario.targetMathMs
        ))
        XCTAssertTrue(grade.action.correct)
        XCTAssertTrue(grade.math.correct)
        XCTAssertEqual(grade.decisionEloDelta, 9)
        XCTAssertEqual(grade.mathEloDelta, 7)
        XCTAssertEqual(grade.decisionEloAfter, 1209)
        XCTAssertEqual(grade.timing.pace, "fast")
    }

    func testDecisionTimingUsesMobileSurface() throws {
        let result = try mainBridge().decisionTiming(DecisionTimingInput(
            seed: "unit-timing",
            decisionId: "d1",
            street: "flop",
            action: "call",
            cutoffCloseness: 0.4,
            uncertainty: 0.5,
            tempo: 0.1,
            presentationRate: 1,
            surface: "mobile"
        ))
        XCTAssertEqual(result.surface, "mobile")
        XCTAssertEqual(result.delayMs, 1294)
        XCTAssertLessThanOrEqual(result.unscaledDelayMs, 2800)
    }

    func testTimedBlindsForceAllInAtDeadline() throws {
        let decision = try mainBridge().timedBlinds(TimedBlindInput(
            durationMinutes: 30,
            elapsedMs: 30 * 60_000,
            current: TimedBlindLevel(smallBlind: 100, bigBlind: 200, bigBlindAnte: 200),
            players: [
                ("a", 30_000, false),
                ("b", 22_000, false),
                ("c", 15_000, false),
            ],
            startingTotalChips: 67_000
        ))
        XCTAssertEqual(decision.phase, "deadline")
        XCTAssertEqual(decision.bigBlind, 22_000)
        XCTAssertEqual(decision.forcedAllInStack, 22_000)
    }

    func testBotDecisionStaysWithinTheSimulationCap() throws {
        for style in ["normal", "rational"] {
            let decision = try mainBridge().botDecision(BotDecisionInput(
                style: style,
                hero: [PokerCard(rank: "A", suit: "spades"), PokerCard(rank: "K", suit: "spades")],
                board: [
                    PokerCard(rank: "Q", suit: "spades"),
                    PokerCard(rank: "J", suit: "hearts"),
                    PokerCard(rank: "2", suit: "clubs"),
                ],
                opponents: 2,
                pot: 1200,
                toCall: 400,
                bigBlind: 200,
                effectiveStack: 18_400,
                legalRaiseTo: 1200,
                seed: "unit-bot"
            ))
            XCTAssertTrue(["fold", "check", "call", "raise", "all-in"].contains(decision.action))
            XCTAssertLessThanOrEqual(decision.work.completedSimulations, 600)
        }
    }

    func testEquityIsDeterministicAndCapped() throws {
        let hero = [PokerCard(rank: "A", suit: "spades"), PokerCard(rank: "K", suit: "spades")]
        let board = [
            PokerCard(rank: "Q", suit: "spades"),
            PokerCard(rank: "J", suit: "hearts"),
            PokerCard(rank: "2", suit: "clubs"),
        ]
        let bridge = try mainBridge()
        let first = try bridge.estimateEquity(hero: hero, board: board, opponents: 2, seed: "eq", simulations: 200)
        let second = try bridge.estimateEquity(hero: hero, board: board, opponents: 2, seed: "eq", simulations: 200)
        XCTAssertEqual(first, second)

        let capped = try bridge.estimateEquity(hero: hero, board: board, opponents: 2, seed: "eq", simulations: 100_000)
        XCTAssertLessThanOrEqual(capped.work.completedSimulations, 600)
    }

    func testUnknownOperationFailsClosed() throws {
        let bridge = try mainBridge()
        XCTAssertThrowsError(try bridge.invoke(EngineRequest(operation: "does-not-exist")))
    }
}
