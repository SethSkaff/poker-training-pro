import SwiftUI

struct PokerTableView: View {
    let mode: TrainingMode
    let timedMinutes: Int?

    @State private var deal = DealPreview.placeholder
    @State private var engineStatus = "Loading local engine"
    @State private var engineFailed = false
    @State private var heroCardsRevealed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var cardWidth = 48

    init(mode: TrainingMode, timedMinutes: Int? = nil) {
        self.mode = mode
        self.timedMinutes = timedMinutes
    }

    var body: some View {
        ZStack {
            BrandTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 18) {
                    statusHeader
                    table
                    controls
                }
                .padding(16)
                .frame(maxWidth: 780)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(mode.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            loadDeterministicDeal()
        }
    }

    private var statusHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("HAND 001")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(BrandTheme.gold)
                Text(engineStatus)
                    .font(.subheadline)
                    .foregroundStyle(engineFailed ? BrandTheme.danger : .secondary)
            }

            Spacer()

            Text("100 / 200")
                .font(.headline.monospacedDigit())
                .accessibilityLabel("Blinds 100 and 200")

            if let timedMinutes {
                Text("\(timedMinutes) MIN")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.gold)
                    .accessibilityLabel("Timed table budget, \(timedMinutes) minutes")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var table: some View {
        VStack(spacing: 22) {
            HStack {
                PlayerBadge(name: "Maya", stack: "18,400", position: "Active", liveCards: true)
                Spacer()
                PlayerBadge(name: "Rafael", stack: "15,900", position: "Folded", liveCards: false)
            }

            HStack(spacing: 8) {
                ForEach(deal.board) { card in
                    PlayingCardView(card: card, width: cardWidth)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Flop, \(spokenCards(deal.board))")

            Text("POT 1,200")
                .font(.headline.weight(.heavy))
                .foregroundStyle(BrandTheme.gold)
                .accessibilityLabel("Pot, 1,200 chips")

            HStack {
                PlayerBadge(name: "Lena", stack: "22,100", position: "Active", liveCards: true)
                Spacer()
                PlayerBadge(name: "Juno", stack: "12,600", position: "Active", liveCards: true)
            }

            HStack(spacing: 10) {
                PlayerBadge(name: "You", stack: "20,000", position: "Big blind", liveCards: true)
                Spacer(minLength: 8)
                Button {
                    if reduceMotion {
                        heroCardsRevealed.toggle()
                    } else {
                        withAnimation(.easeInOut(duration: 0.22)) {
                            heroCardsRevealed.toggle()
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        ForEach(deal.hero) { card in
                            if heroCardsRevealed {
                                PlayingCardView(card: card, width: cardWidth)
                                    .transition(.opacity)
                            } else {
                                PlayingCardBackView(width: cardWidth)
                                    .transition(.opacity)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    heroCardsRevealed
                        ? "Hide your cards, \(spokenCards(deal.hero))"
                        : "Reveal your two cards"
                )
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, minHeight: 330)
        .background(
            RoundedRectangle(cornerRadius: 90, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [BrandTheme.felt, BrandTheme.feltDark],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .shadow(color: .black.opacity(0.45), radius: 18, y: 10)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 90, style: .continuous)
                .stroke(BrandTheme.gold.opacity(0.65), lineWidth: 4)
                .padding(7)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Poker table")
    }

    private var controls: some View {
        HStack(spacing: 10) {
            ActionButton(title: "Fold", tint: BrandTheme.danger) {
                selectAction("Fold")
            }
            ActionButton(title: "Call 400", tint: BrandTheme.panel) {
                selectAction("Call 400")
            }
            ActionButton(title: "Raise", tint: BrandTheme.gold, darkText: true) {
                selectAction("Raise")
            }
        }
    }

    private func spokenCards(_ cards: [PokerCard]) -> String {
        cards.map { "\($0.rank) of \($0.suit)" }.joined(separator: ", ")
    }

    private func selectAction(_ action: String) {
        engineStatus = "\(action) selected for this preview"
        engineFailed = false
    }

    @MainActor
    private func loadDeterministicDeal() {
        do {
            let engine = try SharedPokerEngineBridge()
            deal = try engine.dealPreview(seed: mode.deterministicSeed)
            engineStatus = "Local deterministic engine"
            engineFailed = false
        } catch {
            engineStatus = "Preview fallback: \(error.localizedDescription)"
            engineFailed = true
        }
    }
}

private struct PlayerBadge: View {
    let name: String
    let stack: String
    let position: String
    let liveCards: Bool

    var body: some View {
        HStack(spacing: 9) {
            if liveCards {
                HStack(spacing: -5) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.blue.opacity(0.88))
                        .frame(width: 13, height: 19)
                        .rotationEffect(.degrees(-7))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.blue.opacity(0.88))
                        .frame(width: 13, height: 19)
                        .rotationEffect(.degrees(7))
                }
                .accessibilityHidden(true)
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.headline)
                Text("\(stack) · \(position)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(0.36), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(name), \(stack) chips, \(position), \(liveCards ? "cards live" : "no cards")"
        )
    }
}

private struct PlayingCardBackView: View {
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

private struct PlayingCardView: View {
    let card: PokerCard
    let width: CGFloat
    @AppStorage("settings.colorAssist") private var colorAssist = false

    var body: some View {
        VStack(spacing: 0) {
            Text(card.rank)
                .font(.headline.weight(.black))
            Text(card.symbol)
                .font(.title3)
        }
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

private struct ActionButton: View {
    let title: String
    let tint: Color
    var darkText = false
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.headline)
            .foregroundStyle(darkText ? BrandTheme.midnight : BrandTheme.cream)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(tint, in: RoundedRectangle(cornerRadius: 13))
            .contentShape(Rectangle())
    }
}
