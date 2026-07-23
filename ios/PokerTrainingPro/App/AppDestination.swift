import Foundation

enum AppDestination: Hashable {
    case modes
    case settings
    case timedTableSetup
    case table(TrainingMode, timedMinutes: Int?)
}
