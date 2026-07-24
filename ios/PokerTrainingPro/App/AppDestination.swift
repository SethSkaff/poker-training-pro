import Foundation

enum AppDestination: Hashable {
    case modes
    case settings
    case timedTableSetup
    case training
    case table(TrainingMode, timedMinutes: Int?)
}
