import SwiftUI

struct ModeSelectionView: View {
    private let columns = [
        GridItem(.adaptive(minimum: 250, maximum: 360), spacing: 18)
    ]

    var body: some View {
        ZStack {
            BrandTheme.background.ignoresSafeArea()

            ScrollView {
                LazyVGrid(columns: columns, spacing: 18) {
                    ForEach(TrainingMode.allCases) { mode in
                        NavigationLink(value: destination(for: mode)) {
                            ModeCard(mode: mode)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Starts \(mode.title)")
                    }
                }
                .padding(24)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Choose a Mode")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func destination(for mode: TrainingMode) -> AppDestination {
        switch mode {
        case .timedTable: return .timedTableSetup
        case .training: return .training
        case .normal, .rational: return .table(mode, timedMinutes: nil)
        }
    }
}

private struct ModeCard: View {
    let mode: TrainingMode

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: mode.systemImage)
                .font(.title)
                .foregroundStyle(BrandTheme.gold)
                .accessibilityHidden(true)

            Text(mode.title)
                .font(.title3.weight(.bold))
                .foregroundStyle(BrandTheme.cream)

            Text(mode.subtitle)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)

            Label("Start", systemImage: "arrow.right")
                .font(.headline)
                .foregroundStyle(BrandTheme.gold)
        }
        .frame(maxWidth: .infinity, minHeight: 178, alignment: .leading)
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(BrandTheme.panel)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.10), lineWidth: 1)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
