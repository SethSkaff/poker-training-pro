import SwiftUI

/// The mobile shell renders only the hero-safe snapshot returned by the shared
/// tournament runner. Normal, Rational, and Timed Table therefore use the
/// same cards, pots, blind rules, and legal-action engine as desktop; Training
/// remains a separate one-move coaching route in `TrainingQuizView`.
struct PokerTableView: View {
    let mode: TrainingMode
    let timedMinutes: Int?
    private let store: ProgressStoring

    private let heroID = "mobile-hero"
    @State private var session: MobileTournamentSessionResponse?
    @State private var progress = LocalProgress()
    @State private var engineStatus = "Loading local table"
    @State private var engineFailed = false
    @State private var heroCardsRevealed = false
    @State private var opponentThinking = false
    @State private var pendingAction: PendingTableAction?
    @State private var shownAt = Date()
    @State private var raiseTo = 0
    @State private var completionRecorded = false
    @State private var bridge: SharedTournamentSessionBridge?

    @StateObject private var timing = TableTimingModel()

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(SettingsKey.presentationRate) private var presentationRate = 1.0
    @ScaledMetric(relativeTo: .body) private var cardWidth = 48

    // Drives a presentation-only opponent delay. The selected action is sent
    // once this delay resolves; Skip does not alter the action or the engine.
    private let ticker = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    init(
        mode: TrainingMode,
        timedMinutes: Int? = nil,
        store: ProgressStoring = LocalProgressStore()
    ) {
        self.mode = mode
        self.timedMinutes = timedMinutes
        self.store = store
    }

    var body: some View {
        ZStack {
            BrandTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 18) {
                    statusHeader
                    tableSurface
                    controls
                }
                .padding(16)
                .frame(maxWidth: 780)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(mode.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { startLiveSession() }
        .onReceive(ticker) { _ in
            if scenePhase == .active { timing.tick() }
        }
        .onChange(of: scenePhase) { _, phase in
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
                Text(currentTable?.title ?? mode.title.uppercased())
                    .font(.caption.weight(.bold))
                    .foregroundStyle(BrandTheme.gold)
                    .lineLimit(1)
                Text(engineStatus)
                    .font(.subheadline)
                    .foregroundStyle(engineFailed ? BrandTheme.danger : .secondary)
            }

            Spacer(minLength: 12)

            if let blinds = currentTable?.blinds, blinds.count >= 2 {
                Text("\(blinds[0]) / \(blinds[1])")
                    .font(.headline.monospacedDigit())
                    .accessibilityLabel("Blinds \(blinds[0]) and \(blinds[1])")
            }

            if let timedMinutes {
                Text("\(timedMinutes) MIN")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.gold)
                    .accessibilityLabel("Timed table budget, \(timedMinutes) minutes")
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var tableSurface: some View {
        if let table = currentTable {
            liveTable(table)
        } else {
            if session?.result == nil {
                ProgressView(engineStatus)
                    .tint(BrandTheme.gold)
                    .frame(maxWidth: .infinity, minHeight: 300)
                    .accessibilityLabel(engineStatus)
            } else {
                EmptyView()
            }
        }
    }

    private func liveTable(_ table: MobileTournamentTable) -> some View {
        VStack(spacing: 18) {
            VStack(spacing: 9) {
                ForEach(Array(opponentRows.enumerated()), id: \.offset) { _, row in
                    if row.count == 2, let leading = row.first, let trailing = row.last {
                        playerRow(PlayerBadge(player: leading), PlayerBadge(player: trailing))
                    } else if let player = row.first {
                        HStack {
                            PlayerBadge(player: player)
                            Spacer(minLength: 12)
                        }
                    }
                }
            }

            if table.board.isEmpty {
                Text("Pre-flop")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Pre-flop, no board cards")
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(table.board) { card in
                            PlayingCardView(card: card, width: cardWidth)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(table.street.capitalized), \(spokenCards(table.board))")
            }

            Text("POT \(table.pot.formatted())")
                .font(.headline.weight(.heavy))
                .foregroundStyle(BrandTheme.gold)
                .accessibilityLabel("Pot, \(table.pot) chips")

            if opponentThinking {
                thinkingIndicator
            } else {
                Text(table.prompt)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrandTheme.cream)
                    .multilineTextAlignment(.center)
                    .accessibilityElement(children: .combine)
            }

            HStack(spacing: 10) {
                if let hero = table.players.first(where: { $0.id == heroID }) {
                    PlayerBadge(player: hero)
                }
                Spacer(minLength: 8)
                Button { toggleHeroCards() } label: {
                    HStack(spacing: 6) {
                        ForEach(table.heroCards) { card in
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
                        ? "Hide your cards, \(spokenCards(table.heroCards))"
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
            Text("Table is resolving…")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ProgressView(value: timing.progress)
                .tint(BrandTheme.gold)
                .frame(maxWidth: 220)
            if timing.isRunning {
                Button("Skip opponent animation") { timing.finish() }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.bordered)
                    .accessibilityHint("Completes only the visual wait. It does not change the selected poker action.")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Table is resolving")
    }

    @ViewBuilder
    private var controls: some View {
        if let result = session?.result {
            completionCard(result)
        } else if let legal = session?.legalActions, currentTable != nil {
            VStack(spacing: 10) {
                if let range = raiseRange {
                    raiseControl(range)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { actionButtons(legal) }
                    VStack(spacing: 10) { actionButtons(legal) }
                }
            }
            .disabled(opponentThinking)
        }
    }

    @ViewBuilder
    private func actionButtons(_ legal: MobileLegalActions) -> some View {
        if legal.fold {
            ActionButton(title: "Fold", tint: BrandTheme.danger) { selectAction("fold") }
        }
        if legal.check {
            ActionButton(title: "Check", tint: BrandTheme.panel) { selectAction("check") }
        }
        if legal.call {
            ActionButton(title: "Call \(legal.callAmount.formatted())", tint: BrandTheme.panel) {
                selectAction("call")
            }
        }
        if raiseRange != nil {
            ActionButton(title: legal.bet == nil ? "Raise" : "Bet", tint: BrandTheme.gold, darkText: true) {
                selectAction("raise", raiseTo: raiseTo)
            }
        }
        if legal.allIn {
            ActionButton(title: "All-in", tint: BrandTheme.gold, darkText: true) {
                selectAction("all-in")
            }
        }
    }

    private func raiseControl(_ range: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("Raise to \(raiseTo.formatted())")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(range.lowerBound.formatted())–\(range.upperBound.formatted())")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(
                value: Binding(
                    get: { Double(raiseTo) },
                    set: { raiseTo = Int($0.rounded()).clamped(to: range) }
                ),
                in: Double(range.lowerBound)...Double(range.upperBound),
                step: 1
            )
            .tint(BrandTheme.gold)
            .accessibilityLabel("Raise amount")
            .accessibilityValue("\(raiseTo) chips")
        }
        .padding(12)
        .background(BrandTheme.panel, in: RoundedRectangle(cornerRadius: 13))
    }

    private func completionCard(_ result: MobileTournamentResult) -> some View {
        VStack(spacing: 10) {
            Image(systemName: result.qualified ? "trophy.fill" : "flag.checkered")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(BrandTheme.gold)
                .accessibilityHidden(true)
            Text(result.eventName)
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(result.placementLabel)
                .font(.title2.weight(.heavy))
                .foregroundStyle(BrandTheme.cream)
            Text(result.qualificationLabel)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Text(result.tournamentEloDelta >= 0 ? "+\(result.tournamentEloDelta) Tournament Elo" : "\(result.tournamentEloDelta) Tournament Elo")
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(result.tournamentEloDelta >= 0 ? Color.green : BrandTheme.danger)
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .background(BrandTheme.panel, in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func playerRow<Leading: View, Trailing: View>(
        _ leading: Leading,
        _ trailing: Trailing
    ) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                leading
                Spacer(minLength: 12)
                trailing
            }
            VStack(alignment: .leading, spacing: 8) {
                leading
                trailing
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var currentTable: MobileTournamentTable? { session?.table }

    private var opponentRows: [[MobileTournamentPlayer]] {
        let players = (currentTable?.players ?? []).filter { $0.id != heroID }
        return stride(from: 0, to: players.count, by: 2).map { start in
            Array(players[start..<min(start + 2, players.count)])
        }
    }

    private var raiseRange: ClosedRange<Int>? {
        guard let legal = session?.legalActions else { return nil }
        if let raise = legal.raise { return raise.minTo...raise.maxTo }
        if let bet = legal.bet { return bet.min...bet.max }
        return nil
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

    private func selectAction(_ action: String, raiseTo: Int? = nil) {
        guard session?.replay != nil, !opponentThinking else { return }
        pendingAction = PendingTableAction(action: action, raiseTo: raiseTo)
        opponentThinking = true
        engineStatus = "Resolving local table"
        engineFailed = false

        let rate = reduceMotion ? max(presentationRate, 2.5) : presentationRate
        // This is deliberately presentation-only. The shared engine receives
        // the user's actual think time below and remains authoritative.
        timing.begin(seconds: max(0.12, 0.85 / max(0.5, rate))) {
            commitPendingAction()
        }
    }

    private func commitPendingAction() {
        guard let bridge, let current = session, let pending = pendingAction else { return }
        let elapsed = max(0, Int(Date().timeIntervalSince(shownAt) * 1_000))
        do {
            let response = try bridge.actTournament(
                replay: current.replay,
                action: pending.action,
                raiseTo: pending.raiseTo,
                nowMs: nowMilliseconds(),
                decisionElapsedMs: elapsed
            )
            apply(response)
        } catch {
            opponentThinking = false
            pendingAction = nil
            engineStatus = "Local table error: \(error.localizedDescription)"
            engineFailed = true
        }
    }

    private func startLiveSession() {
        guard mode != .training else { return }
        progress = store.load()
        completionRecorded = false
        do {
            let localBridge = try SharedTournamentSessionBridge()
            bridge = localBridge
            let career = progress.careerResults
                .compactMap { $0.asMobileCareerResult() }
                .latestByEventID()
            let response = try localBridge.createTournament(
                kind: mode == .timedTable ? "timed" : "career",
                mode: mode == .rational ? "rational" : "normal",
                minutes: timedMinutes,
                seed: "\(mode.deterministicSeed):\(nowMilliseconds())",
                nowMs: nowMilliseconds(),
                heroID: heroID,
                heroName: "You",
                heroRating: progress.tournamentElo,
                careerResults: mode == .timedTable ? [] : career
            )
            apply(response)
        } catch {
            engineStatus = "Local table unavailable: \(error.localizedDescription)"
            engineFailed = true
        }
    }

    private func apply(_ response: MobileTournamentSessionResponse) {
        session = response
        opponentThinking = false
        pendingAction = nil
        shownAt = Date()
        heroCardsRevealed = false
        engineStatus = response.complete ? "Table complete" : "Your move"
        engineFailed = false
        if let range = raiseRange { raiseTo = range.lowerBound }
        if let result = response.result { recordCompletion(result) }
    }

    private func recordCompletion(_ result: MobileTournamentResult) {
        guard !completionRecorded else { return }
        completionRecorded = true
        progress.tournamentElo += result.tournamentEloDelta
        progress.completedHands += 1
        progress.lastMode = mode
        if mode != .timedTable {
            progress.careerResults.append(
                CareerEventResult(
                    id: "\(result.eventId)-\(nowMilliseconds())",
                    mode: mode,
                    placement: result.finishPlace,
                    entrants: result.fieldSize,
                    tournamentEloDelta: result.tournamentEloDelta,
                    completedAt: Date(),
                    eventId: result.eventId,
                    sourceFieldSize: result.sourceFieldSize,
                    qualifyingPlaces: result.qualifyingPlaces,
                    qualified: result.qualified
                )
            )
        }
        try? store.save(progress)
    }

    private func nowMilliseconds() -> Int {
        Int(Date().timeIntervalSince1970 * 1_000)
    }
}

private struct PendingTableAction {
    let action: String
    let raiseTo: Int?
}

private struct PlayerBadge: View {
    let player: MobileTournamentPlayer

    private var cardsLive: Bool {
        player.status != "folded" && player.status != "out" && player.status != "eliminated"
    }

    private var statusLabel: String {
        let status = player.status.replacingOccurrences(of: "-", with: " ").capitalized
        return player.bet > 0 ? "\(status) · Bet \(player.bet.formatted())" : status
    }

    var body: some View {
        HStack(spacing: 9) {
            if cardsLive {
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
                Text(player.name).font(.headline)
                Text("\(player.stack.formatted()) · \(statusLabel)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(0.36), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(player.name), \(player.stack) chips, \(statusLabel), \(cardsLive ? "cards live" : "no cards")"
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

private extension Int {
    func clamped(to range: ClosedRange<Int>) -> Int {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

private extension Array where Element == MobileCareerResult {
    /// A career event can be replayed. The latest public result is the one the
    /// engine needs for qualification on the next launch.
    func latestByEventID() -> [MobileCareerResult] {
        Dictionary(grouping: self, by: \.eventId).compactMap { $0.value.last }
    }
}
