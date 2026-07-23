import SwiftUI

struct TimedTableSetupView: View {
    @State private var minutes = 30

    var body: some View {
        ZStack {
            BrandTheme.background.ignoresSafeArea()

            VStack(spacing: 24) {
                Image(systemName: "timer")
                    .font(.system(size: 48, weight: .bold))
                    .foregroundStyle(BrandTheme.gold)
                    .accessibilityHidden(true)

                VStack(spacing: 8) {
                    Text("How much time do you have left?")
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center)

                    Text("Blinds begin normally, then increase to bring this single table toward a finish.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Stepper(value: $minutes, in: 5...180, step: 5) {
                    HStack {
                        Text("Available time")
                        Spacer()
                        Text("\(minutes) minutes")
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(BrandTheme.gold)
                    }
                }
                .accessibilityValue("\(minutes) minutes")

                NavigationLink(
                    value: AppDestination.table(.timedTable, timedMinutes: minutes)
                ) {
                    Label("Start Timed Table", systemImage: "play.fill")
                        .font(.headline)
                        .foregroundStyle(BrandTheme.midnight)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(BrandTheme.gold, in: RoundedRectangle(cornerRadius: 15))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Starts one table with a \(minutes) minute target")
            }
            .padding(24)
            .frame(maxWidth: 520)
        }
        .navigationTitle("Timed Table")
        .navigationBarTitleDisplayMode(.inline)
    }
}
