import Foundation

enum TrainingMode: String, CaseIterable, Codable, Hashable, Identifiable {
    case training
    case rational
    case normal
    case timedTable

    var id: Self { self }

    var title: String {
        switch self {
        case .training: "Training"
        case .rational: "Rational"
        case .normal: "Normal"
        case .timedTable: "Timed Table"
        }
    }

    var subtitle: String {
        switch self {
        case .training: "Practice decisions with immediate coaching."
        case .rational: "Slow the hand down and expose the math."
        case .normal: "Play clean hands without training prompts."
        case .timedTable: "Choose your available minutes; rising blinds shape one complete table."
        }
    }

    var systemImage: String {
        switch self {
        case .training: "graduationcap.fill"
        case .rational: "function"
        case .normal: "suit.spade.fill"
        case .timedTable: "timer"
        }
    }

    var deterministicSeed: String {
        "ios-preview:\(rawValue):1"
    }
}
