import SwiftUI

struct PokerTableView: View {
    let mode: TrainingMode
    let timedMinutes: Int?

    @State private var deal = DealPreview.placeholder
    @State private var engineStatus = "Loading local engine"
    @State private var engineFailed = false
    @State private var heroCardsRevealed = false
    @State private var opponentThinking = false
    @State private var opponentActionText = ""
    @State private var bridge: SharedPokerEngineBridge?

    @StateObject private var timing = TableTimingModel()

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(SettingsKey.presentationRate) private var presentationRate = 1.0
    @ScaledMetric(relativeTo: .body) private var cardWidth = 48

    // Drives the frozen-remaining-time countdown only while the scene is active.
    private let ticker = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

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
        .task { loadDeterministicDeal() }
        .onReceive(ticker) { _ in
            if scenePhase == .active { timing.tick() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Freeze the exact remaining opponent delay on background/inactive;
            // resume from that frozen time on return.
            if phase == .active {
                timing.resume()
            } else {
                timing.pause()
            }
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

            if opponentThinking || !opponentActionText.isEmpty {
                thinkingIndicator
            }

            HStack {
                PlayerBadge(name: "Lena", stack: "22,100", position: "Active", liveCards: true)
                Spacer()
                PlayerBadge(name: "Juno", stack: "12,600", position: "Active", liveCards: true)
            }

            HStack(spacing: 10) {
                PlayerBadge(name: "You", stack: "20,000", position: "Big blind", liveCards: true)
                Spacer(minLength: 8)
                Button {
                    toggleHeroCards()
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

    private var thinkingIndicator: some View {
        VStack(spacing: 4) {
            if opponentThinking {
                Text("Maya is thinking…")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ProgressView(value: timing.progress)
                    .tint(BrandTheme.gold)
                    .frame(maxWidth: 220)
            } else {
                Text(opponentActionText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrandTheme.cream)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(opponentThinking ? "Opponent is thinking" : opponentActionText)
    }

    private var controls: some View {
        HStack(spacing: 10) {
            ActionButton(title: "Fold", tint: BrandTheme.danger) { selectAction("Fold") }
            ActionButton(title: "Call 400", tint: BrandTheme.panel) { selectAction("Call 400") }
            ActionButton(title: "Raise", tint: BrandTheme.gold, darkText: true) { selectAction("Raise") }
        }
    }

    private func spokenCards(_ cards: [PokerCard]) -> String {
        cards.map { "\($0.rank) of \($0.suit)" }.joined(separator: ", ")
    }

    private func toggleHeroCards() {
        if reduceMotion {
            heroCardsRevealed.toggle()
        } else {
            withAnimation(.easeInOut(duration: 0.22)) { heroCardsRevealed.toggle() }
        }
    }

    private func selectAction(_ action: String) {
        engineStatus = "\(action) selected for this preview"
        engineFailed = false
        beginOpponentDecision()
    }

    /// Uses the shared decision-timing model with the mobile surface budget and
    /// the user's speed preference. Reduce Motion further shortens the wait.
    private func beginOpponentDecision() {
        guard let bridge else { return }
        opponentActionText = ""
        // Reduce Motion trims the presentation budget by biasing the rate faster.
        let rate = reduceMotion ? max(presentationRate, 2.5) : presentationRate
        do {
            let result = try bridge.decisionTiming(DecisionTimingInput(
                seed: mode.deterministicSeed,
                decisionId: "opp-\(UUID().uuidString)",
                street: "flop",
                action: "call",
                cutoffCloseness: 0.4,
                uncertainty: 0.5,
                tempo: 0.1,
                presentationRate: rate,
                surface: "mobile"
            ))
            opponentThinking = true
            timing.begin(seconds: result.delaySeconds) {
                resolveOpponentDecision()
            }
        } catch {
            resolveOpponentDecision()
        }
    }

    private func resolveOpponentDecision() {
        opponentThinking = false
        guard let bridge, mode == .normal || mode == .rational else {
            opponentActionText = "Maya checks."
            return
        }
        do {
            let decision = try bridge.botDecision(BotDecisionInput(
                style: mode == .rational ? "rational" : "normal",
                hero: deal.hero,
                board: deal.board,
                opponents: 1,
                pot: 1200,
                toCall: 0,
                bigBlind: 200,
                effectiveStack: 18_400,
                legalRaiseTo: 800,
                seed: "\(mode.deterministicSeed):maya",
                simulations: nil
            ))
            let percent = Int((decision.equity * 100).rounded())
            opponentActionText = "Maya \(decision.action)s. (est. equity \(percent)%)"
        } catch {
            opponentActionText = "Maya checks."
        }
    }

    @MainActor
    private func loadDeterministicDeal() {
        do {
            let engine = try SharedPokerEngineBridge()
            bridge = engine
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
