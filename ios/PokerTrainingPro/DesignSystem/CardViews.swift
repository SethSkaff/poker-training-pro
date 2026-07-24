import SwiftUI

/// Shared card presentation used by both the table and Training views so
/// readability, four-color assist, and Dynamic Type scaling behave identically.
struct PlayingCardView: View {
    let card: PokerCard
    let width: CGFloat
    @AppStorage(SettingsKey.colorAssist) private var colorAssist = false

    var body: some View {
        VStack(spacing: 0) {
            Text(card.rank)
                .font(.headline.weight(.black))
            Text(card.symbol)
                .font(.title3)
        }
        .minimumScaleFactor(0.6)
        .foregroundStyle(suitColor)
        .frame(width: width, height: width * 1.38)
        .background(BrandTheme.cream, in: RoundedRectangle(cornerRadius: 7))
        .accessibilityHidden(true)
    }

    private var suitColor: Color {
        guard colorAssist else {
            return card.isRed ? BrandTheme.danger : Color.black
        }
        switch card.suit {
        case "clubs": return Color(red: 0.0, green: 0.42, blue: 0.21)
        case "diamonds": return Color(red: 0.05, green: 0.35, blue: 0.82)
        case "hearts": return BrandTheme.danger
        default: return Color.black
        }
    }
}

struct PlayingCardBackView: View {
    let width: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: 7)
            .fill(
                LinearGradient(
                    colors: [Color.blue, Color.indigo],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay {
                RoundedRectangle(cornerRadius: 7)
                    .stroke(BrandTheme.cream.opacity(0.8), lineWidth: 2)
                    .padding(3)
            }
            .frame(width: width, height: width * 1.38)
            .accessibilityHidden(true)
    }
}
