import Foundation

struct LocalProgress: Codable, Equatable, Sendable {
    var completedHands = 0
    var bestStreak = 0
    var lastMode: TrainingMode?
}

protocol ProgressStoring {
    func load() -> LocalProgress
    func save(_ progress: LocalProgress) throws
}

final class LocalProgressStore: ProgressStoring {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "localProgress.v1") {
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

