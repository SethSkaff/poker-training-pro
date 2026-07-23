import XCTest
@testable import PokerTrainingPro

final class LocalProgressStoreTests: XCTestCase {
    func testRoundTripStaysInsideDedicatedUserDefaultsSuite() throws {
        let suiteName = "PokerTrainingProTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = LocalProgressStore(defaults: defaults, key: "progress")
        let expected = LocalProgress(
            completedHands: 9,
            bestStreak: 4,
            lastMode: .rational
        )

        try store.save(expected)

        XCTAssertEqual(store.load(), expected)
    }

    func testMissingProgressReturnsSafeDefaults() throws {
        let suiteName = "PokerTrainingProTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(LocalProgressStore(defaults: defaults).load(), LocalProgress())
    }
}

