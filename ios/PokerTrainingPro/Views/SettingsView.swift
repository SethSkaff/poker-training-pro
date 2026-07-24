import SwiftUI

/// Shared defaults keys so the table and timing model read the same values the
/// player sets here. `presentationRate` is the mobile user-speed preference
/// applied to the shared decision-timing model (0.5x slow to 3x fast).
enum SettingsKey {
    static let soundEnabled = "settings.soundEnabled"
    static let hapticsEnabled = "settings.hapticsEnabled"
    static let colorAssist = "settings.colorAssist"
    static let presentationRate = "settings.presentationRate"
}

struct SettingsView: View {
    @AppStorage(SettingsKey.soundEnabled) private var soundEnabled = true
    @AppStorage(SettingsKey.hapticsEnabled) private var hapticsEnabled = true
    @AppStorage(SettingsKey.colorAssist) private var colorAssist = false
    @AppStorage(SettingsKey.presentationRate) private var presentationRate = 1.0

    private var speedLabel: String {
        String(format: "%.1fx", presentationRate)
    }

    var body: some View {
        Form {
            Section("Game") {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Table speed")
                        Spacer()
                        Text(speedLabel)
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(BrandTheme.gold)
                    }
                    Slider(value: $presentationRate, in: 0.5...3.0, step: 0.1) {
                        Text("Table speed")
                    } minimumValueLabel: {
                        Text("0.5x").font(.caption2)
                    } maximumValueLabel: {
                        Text("3x").font(.caption2)
                    }
                    .accessibilityValue(speedLabel)
                    Text("Adjusts only how quickly opponents act and cards animate. It never changes the poker math or a decision.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Toggle("Sound effects", isOn: $soundEnabled)
                Toggle("Haptics", isOn: $hapticsEnabled)
            }

            Section("Accessibility") {
                Toggle("Four-color suit assist", isOn: $colorAssist)
                Text("Text size, VoiceOver, Voice Control, Switch Control, contrast, Bold Text, and Reduce Motion follow your system settings. Reduce Motion removes card and camera animation and shortens the timing budget.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Privacy") {
                Label("Progress and settings stay on this device.", systemImage: "lock.shield.fill")
                Text("Fully offline. No account, analytics, ads, tracking, or network client. Play chips only — no real-money wagering.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}
