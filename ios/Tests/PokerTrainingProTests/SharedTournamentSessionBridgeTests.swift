import XCTest
@testable import PokerTrainingPro

@MainActor
final class SharedTournamentSessionBridgeTests: XCTestCase {
    func testNormalTournamentReturnsOnlyHeroCardsAndCanAdvance() throws {
        let bridge = try SharedTournamentSessionBridge(bundle: .main)
        let first = try bridge.createTournament(
            kind: "career",
            eventID: "local-qualifier",
            mode: "normal",
            seed: "ios-native-session-test",
            nowMs: 1_000,
            heroID: "hero",
            heroName: "Mobile Hero",
            heroRating: 1_200
        )

        XCTAssertFalse(first.complete)
        let table = try XCTUnwrap(first.table)
        XCTAssertEqual(table.heroCards.count, 2)
        XCTAssertTrue(
            table.players
                .filter { $0.id != "hero" }
                .allSatisfy { $0.cards == nil },
            "The native boundary must not decode opponents' private cards."
        )

        let legal = try XCTUnwrap(first.legalActions)
        let action: String
        if legal.check {
            action = "check"
        } else if legal.call {
            action = "call"
        } else {
            action = "fold"
        }
        let next = try bridge.actTournament(
            replay: first.replay,
            action: action,
            nowMs: 1_500,
            decisionElapsedMs: 500
        )
        XCTAssertTrue(next.table != nil || next.result != nil)
    }
}
