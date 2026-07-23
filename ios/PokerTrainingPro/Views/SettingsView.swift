import SwiftUI

struct SettingsView: View {
    @AppStorage("settings.soundEnabled") private var soundEnabled = true
    @AppStorage("settings.hapticsEnabled") private var hapticsEnabled = true
    @AppStorage("settings.colorAssist") private var colorAssist = false
    @AppStorage("settings.dealPace") private var dealPace = "standard"

    var body: some View {
        Form {
            Section("Game") {
                Picker("Deal pace", selection: $dealPace) {
                    Text("Cinematic").tag("cinematic")
                    Text("Standard").tag("standard")
                    Text("Quick").tag("quick")
                }

                Toggle("Sound effects", isOn: $soundEnabled)
                Toggle("Haptics", isOn: $hapticsEnabled)
            }

            Section("Accessibility") {
                Toggle("Four-color suit assist", isOn: $colorAssist)
                Text("Text size, VoiceOver, Voice Control, Switch Control, contrast, and Reduce Motion follow system settings.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Privacy") {
                Label("Progress and settings stay on this device.", systemImage: "lock.shield.fill")
                Text("This scaffold contains no account, analytics, ads, tracking, or network client.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

