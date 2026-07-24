import SwiftUI

/// One-move Training: a poker decision plus one related math question graded
/// entirely on-device by the shared engine. Quiz answers accept percentages,
/// decimals, fractions, and ratios (33%, 0.33, 1/3, 2:1). Decision and Math Elo
/// and local progress persist between launches.
struct TrainingQuizView: View {
    private let store: ProgressStoring
    private let scenarios = MobileScenario.bank

    @State private var index = 0
    @State private var selectedAction: String?
    @State private var mathText = ""
    @State private var grade: TrainingGrade?
    @State private var bridge: SharedPokerEngineBridge?
    @State private var engineError: String?
    @State private var progress = LocalProgress()
    @State private var shownAt = Date()
    @State private var actionAt: Date?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var cardWidth = 46

    init(store: ProgressStoring = LocalProgressStore()) {
        self.store = store
    }

    private var scenario: MobileScenario { scenarios[index] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                eloHeader
                cards
                Text(scenario.prompt)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)

                actionButtons
                mathSection

                if let grade {
                    feedback(grade)
                }

                if let engineError {
                    Text(engineError)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.danger)
                }
            }
            .padding(20)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(BrandTheme.background.ignoresSafeArea())
        .navigationTitle(scenario.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { start() }
    }

    private var eloHeader: some View {
        HStack(spacing: 16) {
            eloChip(label: "Decision Elo", value: progress.decisionElo)
            eloChip(label: "Math Elo", value: progress.mathElo)
            Spacer()
            Text("Streak \(progress.currentStreak)")
                .font(.caption.weight(.bold))
                .foregroundStyle(BrandTheme.gold)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Decision Elo \(progress.decisionElo), Math Elo \(progress.mathElo), current streak \(progress.currentStreak)")
    }

    private func eloChip(label: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text("\(value)").font(.headline.monospacedDigit()).foregroundStyle(BrandTheme.cream)
        }
    }

    private var cards: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                ForEach(scenario.heroCards) { card in
                    PlayingCardView(card: card, width: cardWidth)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Your cards, \(spoken(scenario.heroCards))")

            if !scenario.board.isEmpty {
                HStack(spacing: 6) {
                    ForEach(scenario.board) { card in
                        PlayingCardView(card: card, width: cardWidth)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Board, \(spoken(scenario.board))")
            }
        }
    }

    private var actionButtons: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your move").font(.headline)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { actionButtonRow }
                VStack(spacing: 8) { actionButtonRow }
            }
        }
    }

    private var actionButtonRow: some View {
        ForEach(scenario.availableActions, id: \.self) { action in
            Button {
                if actionAt == nil { actionAt = Date() }
                selectedAction = action
            } label: {
                Text(actionTitle(action))
                    .font(.subheadline.weight(.bold))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.plain)
            .foregroundStyle(selectedAction == action ? BrandTheme.midnight : BrandTheme.cream)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(selectedAction == action ? BrandTheme.gold : BrandTheme.panel)
            )
            .accessibilityAddTraits(selectedAction == action ? .isSelected : [])
        }
    }

    private var mathSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(scenario.mathPrompt)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            TextField(placeholder, text: $mathText)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numbersAndPunctuation)
                .autocorrectionDisabled()
                .disabled(grade != nil)
                .accessibilityLabel("Math answer")
                .accessibilityHint("Accepts a percent, decimal, fraction, or ratio")

            if grade == nil {
                Button {
                    submit()
                } label: {
                    Text("Submit answer")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(PrimaryMenuButtonStyle())
                .disabled(selectedAction == nil || mathText.trimmingCharacters(in: .whitespaces).isEmpty)
            } else {
                Button {
                    advance()
                } label: {
                    Text(index + 1 < scenarios.count ? "Next scenario" : "Restart set")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(PrimaryMenuButtonStyle())
            }
        }
    }

    private var placeholder: String {
        switch scenario.mathUnit {
        case "%": return "e.g. 33%, 0.33, 1/3, or 2:1"
        case "chips": return "e.g. 5500"
        case "ratio": return "e.g. 3:5"
        default: return "e.g. 9"
        }
    }

    private func feedback(_ grade: TrainingGrade) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            resultRow(
                title: "Decision",
                correct: grade.action.correct,
                close: grade.action.close,
                detail: grade.action.explanation,
                delta: grade.decisionEloDelta
            )
            resultRow(
                title: "Math",
                correct: grade.math.correct,
                close: grade.math.close,
                detail: grade.math.explanation,
                delta: grade.mathEloDelta
            )
            Text("Pace: \(grade.timing.pace.capitalized)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(BrandTheme.panel))
        .accessibilityElement(children: .contain)
    }

    private func resultRow(title: String, correct: Bool, close: Bool, detail: String, delta: Int) -> some View {
        let status = correct ? "Correct" : close ? "Close" : "Off"
        let symbol = correct ? "checkmark.circle.fill" : close ? "circle.lefthalf.filled" : "xmark.circle.fill"
        let tint = correct ? Color.green : close ? BrandTheme.gold : BrandTheme.danger
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label("\(title): \(status)", systemImage: symbol)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(tint)
                Spacer()
                Text(delta >= 0 ? "+\(delta) Elo" : "\(delta) Elo")
                    .font(.caption.monospacedDigit().weight(.bold))
                    .foregroundStyle(delta >= 0 ? Color.green : BrandTheme.danger)
            }
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title) \(status), \(delta) Elo. \(detail)")
    }

    private func actionTitle(_ action: String) -> String {
        switch action {
        case "all-in": return "All-in"
        default: return action.capitalized
        }
    }

    private func spoken(_ cards: [PokerCard]) -> String {
        cards.map { "\($0.rank) of \($0.suit)" }.joined(separator: ", ")
    }

    private func start() {
        progress = store.load()
        if bridge == nil {
            do { bridge = try SharedPokerEngineBridge() }
            catch { engineError = "Local engine unavailable: \(error.localizedDescription)" }
        }
        shownAt = Date()
    }

    private func submit() {
        guard let bridge, let action = selectedAction else { return }
        let now = Date()
        let actionMs = Int(((actionAt ?? now).timeIntervalSince(shownAt)) * 1000)
        let mathMs = Int(now.timeIntervalSince(actionAt ?? shownAt) * 1000)

        do {
            let result = try bridge.gradeTraining(TrainingGradeInput(
                action: action,
                mathInput: mathText,
                unit: scenario.mathUnit,
                correctValue: scenario.correctValue,
                tolerance: scenario.tolerance,
                mathExplanation: scenario.mathExplanation,
                actionEvs: scenario.actionEvs,
                actionEpsilon: scenario.actionEpsilon,
                partialCreditRegret: scenario.partialCreditRegret,
                acceptableActions: scenario.acceptableActions,
                actionReason: scenario.actionReason,
                decisionElo: progress.decisionElo,
                mathElo: progress.mathElo,
                decisionDifficulty: scenario.decisionDifficulty,
                mathDifficulty: scenario.mathDifficulty,
                decisionAttempts: progress.trainingCompleted,
                mathAttempts: progress.trainingCompleted,
                actionElapsedMs: max(0, actionMs),
                mathElapsedMs: max(0, mathMs),
                targetDecisionMs: scenario.targetDecisionMs,
                targetMathMs: scenario.targetMathMs
            ))
            apply(result)
        } catch {
            engineError = "Grading failed: \(error.localizedDescription)"
        }
    }

    private func apply(_ result: TrainingGrade) {
        if reduceMotion {
            grade = result
        } else {
            withAnimation(.easeInOut(duration: 0.2)) { grade = result }
        }
        progress.decisionElo = result.decisionEloAfter
        progress.mathElo = result.mathEloAfter
        progress.trainingCompleted += 1
        progress.completedHands += 1
        progress.totalDecisionMs += Int(result.timing.totalMs)
        progress.lastMode = .training
        if result.action.correct && result.math.correct {
            progress.currentStreak += 1
            progress.bestStreak = max(progress.bestStreak, progress.currentStreak)
        } else {
            progress.currentStreak = 0
        }
        try? store.save(progress)
    }

    private func advance() {
        index = (index + 1) % scenarios.count
        selectedAction = nil
        mathText = ""
        grade = nil
        actionAt = nil
        shownAt = Date()
    }
}
