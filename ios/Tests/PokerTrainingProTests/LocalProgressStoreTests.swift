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

    func testPreservesEloStreakAndCareerResults() throws {
        let suiteName = "PokerTrainingProTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = LocalProgressStore(defaults: defaults, key: "progress")

        var expected = LocalProgress()
        expected.decisionElo = 1340
        expected.mathElo = 1275
        expected.tournamentElo = 1410
        expected.trainingCompleted = 12
        expected.currentStreak = 3
        expected.bestStreak = 5
        expected.totalDecisionMs = 84_000
        expected.careerResults = [
            CareerEventResult(
                id: "event-1",
                mode: .normal,
                placement: 2,
                entrants: 9,
                tournamentEloDelta: 18,
                completedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        ]

        try store.save(expected)
        XCTAssertEqual(store.load(), expected)
    }

    func testDefensivelyDecodesLegacyPartialPayload() throws {
        let suiteName = "PokerTrainingProTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        // An older v1 payload only carried these three fields.
        let legacy = #"{"completedHands":7,"bestStreak":4,"lastMode":"rational"}"#
        defaults.set(Data(legacy.utf8), forKey: "legacy")

        let store = LocalProgressStore(defaults: defaults, key: "legacy")
        let loaded = store.load()

        XCTAssertEqual(loaded.completedHands, 7)
        XCTAssertEqual(loaded.bestStreak, 4)
        XCTAssertEqual(loaded.lastMode, .rational)
        // New fields fall back to safe defaults rather than discarding progress.
        XCTAssertEqual(loaded.decisionElo, 1200)
        XCTAssertEqual(loaded.mathElo, 1200)
        XCTAssertTrue(loaded.careerResults.isEmpty)
    }
}

