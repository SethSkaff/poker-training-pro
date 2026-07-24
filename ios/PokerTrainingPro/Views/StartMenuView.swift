import SwiftUI

struct StartMenuView: View {
    var body: some View {
        ZStack {
            BrandTheme.background.ignoresSafeArea()
            TableGlow()

            ScrollView {
                VStack(spacing: 26) {
                    Spacer(minLength: 18)

                    BrandMark()

                    VStack(spacing: 5) {
                        Text("POKER")
                            .font(.largeTitle.weight(.black))
                            .tracking(5)
                            .foregroundStyle(BrandTheme.cream)
                        Text("TRAINING PRO")
                            .font(.title2.weight(.bold))
                            .tracking(2)
                            .foregroundStyle(BrandTheme.gold)
                    }
                    .multilineTextAlignment(.center)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Poker Training Pro")

                    Text("Make sharper decisions. Master the math.")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    VStack(spacing: 14) {
                        NavigationLink(value: AppDestination.modes) {
                            Label("Play", systemImage: "play.fill")
                        }
                        .buttonStyle(PrimaryMenuButtonStyle())
                        .accessibilityHint("Shows the four training modes")

                        NavigationLink(value: AppDestination.settings) {
                            Label("Settings", systemImage: "gearshape.fill")
                        }
                        .buttonStyle(PrimaryMenuButtonStyle())
                        .accessibilityHint("Opens local game and accessibility settings")
                    }
                    .frame(maxWidth: 430)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .navigationBarHidden(true)
    }
}

private struct TableGlow: View {
    var body: some View {
        Ellipse()
            .fill(BrandTheme.felt.opacity(0.22))
            .frame(maxWidth: 780, maxHeight: 360)
            .blur(radius: 45)
            .padding(30)
            .accessibilityHidden(true)
    }
}

