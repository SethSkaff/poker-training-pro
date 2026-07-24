import Foundation

/// A completed event/table result kept locally so career progress survives
/// relaunch. It never contains opponents' hidden cards.
struct CareerEventResult: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var mode: TrainingMode
    var placement: Int
    var entrants: Int
    var tournamentEloDelta: Int
    var completedAt: Date
}

/// Local, on-device progress. All fields decode defensively so an older or
/// partial payload still loads without discarding the values it does contain.
struct LocalProgress: Codable, Equatable, Sendable {
    var completedHands = 0
    var bestStreak = 0
    var currentStreak = 0
    var lastMode: TrainingMode?

    // Preserved backend surface, mirroring the desktop PlayerProgress fields
    // that matter on mobile.
    var decisionElo = 1200
    var mathElo = 1200
    var tournamentElo = 1200
    var trainingCompleted = 0
    var totalDecisionMs = 0
    var careerResults: [CareerEventResult] = []

    init(
        completedHands: Int = 0,
        bestStreak: Int = 0,
        currentStreak: Int = 0,
        lastMode: TrainingMode? = nil,
        decisionElo: Int = 1200,
        mathElo: Int = 1200,
        tournamentElo: Int = 1200,
        trainingCompleted: Int = 0,
        totalDecisionMs: Int = 0,
        careerResults: [CareerEventResult] = []
    ) {
        self.completedHands = completedHands
        self.bestStreak = bestStreak
        self.currentStreak = currentStreak
        self.lastMode = lastMode
        self.decisionElo = decisionElo
        self.mathElo = mathElo
        self.tournamentElo = tournamentElo
        self.trainingCompleted = trainingCompleted
        self.totalDecisionMs = totalDecisionMs
        self.careerResults = careerResults
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        completedHands = try container.decodeIfPresent(Int.self, forKey: .completedHands) ?? 0
        bestStreak = try container.decodeIfPresent(Int.self, forKey: .bestStreak) ?? 0
        currentStreak = try container.decodeIfPresent(Int.self, forKey: .currentStreak) ?? 0
        lastMode = try container.decodeIfPresent(TrainingMode.self, forKey: .lastMode)
        decisionElo = try container.decodeIfPresent(Int.self, forKey: .decisionElo) ?? 1200
        mathElo = try container.decodeIfPresent(Int.self, forKey: .mathElo) ?? 1200
        tournamentElo = try container.decodeIfPresent(Int.self, forKey: .tournamentElo) ?? 1200
        trainingCompleted = try container.decodeIfPresent(Int.self, forKey: .trainingCompleted) ?? 0
        totalDecisionMs = try container.decodeIfPresent(Int.self, forKey: .totalDecisionMs) ?? 0
        careerResults = try container.decodeIfPresent([CareerEventResult].self, forKey: .careerResults) ?? []
    }
}

protocol ProgressStoring {
    func load() -> LocalProgress
    func save(_ progress: LocalProgress) throws
}

final class LocalProgressStore: ProgressStoring {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "localProgress.v2") {
        self.defaults = defaults
        self.key = key
    }

    func load() -> LocalProgress {
        guard
            let data = defaults.data(forKey: key),
            let progress = try? JSONDecoder().decode(LocalProgress.self, from: data)
        else {
            return LocalProgress()
        }
        return progress
    }

    func save(_ progress: LocalProgress) throws {
        defaults.set(try JSONEncoder().encode(progress), forKey: key)
    }
}
