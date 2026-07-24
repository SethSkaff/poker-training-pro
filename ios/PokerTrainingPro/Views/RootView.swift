import SwiftUI

struct RootView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            StartMenuView()
                .navigationDestination(for: AppDestination.self) { destination in
                    switch destination {
                    case .modes:
                        ModeSelectionView()
                    case .settings:
                        SettingsView()
                    case .timedTableSetup:
                        TimedTableSetupView()
                    case .training:
                        TrainingQuizView()
                    case let .table(mode, timedMinutes):
                        PokerTableView(mode: mode, timedMinutes: timedMinutes)
                    }
                }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview("iPhone") {
    RootView()
}

#Preview("iPad landscape") {
    RootView()
        .previewInterfaceOrientation(.landscapeLeft)
}
