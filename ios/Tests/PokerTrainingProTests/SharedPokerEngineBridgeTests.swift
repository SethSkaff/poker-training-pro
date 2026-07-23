import XCTest
@testable import PokerTrainingPro

@MainActor
final class SharedPokerEngineBridgeTests: XCTestCase {
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
        let bridge = try SharedPokerEngineBridge(bundle: .main)

        let first = try bridge.dealPreview(seed: "same-seed")
        let second = try bridge.dealPreview(seed: "same-seed")

        XCTAssertEqual(first, second)
    }
}
