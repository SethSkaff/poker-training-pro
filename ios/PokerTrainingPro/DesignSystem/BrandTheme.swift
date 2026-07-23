import SwiftUI

enum BrandTheme {
    static let midnight = Color(red: 0.025, green: 0.045, blue: 0.075)
    static let panel = Color(red: 0.065, green: 0.10, blue: 0.14)
    static let felt = Color(red: 0.035, green: 0.33, blue: 0.20)
    static let feltDark = Color(red: 0.02, green: 0.19, blue: 0.12)
    static let gold = Color(red: 0.95, green: 0.72, blue: 0.23)
    static let cream = Color(red: 0.97, green: 0.95, blue: 0.88)
    static let danger = Color(red: 0.82, green: 0.20, blue: 0.22)

    static let background = LinearGradient(
        colors: [midnight, Color.black],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

struct BrandMark: View {
    @ScaledMetric(relativeTo: .largeTitle) private var size = 84

    var body: some View {
        ZStack {
            Circle()
                .fill(BrandTheme.panel)
                .overlay {
                    Circle().stroke(BrandTheme.gold, lineWidth: 3)
                }

            Image(systemName: "suit.spade.fill")
                .font(.system(size: size * 0.48, weight: .bold))
                .foregroundStyle(BrandTheme.cream)

            Text("P")
                .font(.system(size: size * 0.18, weight: .black, design: .rounded))
                .foregroundStyle(BrandTheme.midnight)
                .offset(y: size * 0.11)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct PrimaryMenuButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title2.weight(.heavy))
            .foregroundStyle(BrandTheme.midnight)
            .frame(maxWidth: .infinity, minHeight: 58)
            .padding(.horizontal, 20)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(BrandTheme.gold.opacity(configuration.isPressed ? 0.76 : 1))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.white.opacity(0.28), lineWidth: 1)
            }
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? 0.98 : 1))
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }
}
