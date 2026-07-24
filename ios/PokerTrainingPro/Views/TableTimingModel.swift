import Foundation
import Combine

/// Drives an opponent's presentation delay using the shared decision-timing
/// model, and — critically — freezes the *exact remaining* delay when the app
/// becomes inactive or backgrounded, resuming it on return. This mirrors the
/// desktop lifecycle policy: inactive time is never counted against play, and
/// timers do not run away in the background.
@MainActor
final class TableTimingModel: ObservableObject {
    @Published private(set) var remainingSeconds: Double = 0
    @Published private(set) var totalSeconds: Double = 0
    @Published private(set) var isRunning = false
    @Published private(set) var isPaused = false

    /// Progress from 0 (just started) to 1 (complete).
    var progress: Double {
        guard totalSeconds > 0 else { return 1 }
        return min(1, max(0, 1 - remainingSeconds / totalSeconds))
    }

    private var lastTick: Date?
    private var onComplete: (() -> Void)?

    func begin(seconds: Double, onComplete: @escaping () -> Void) {
        totalSeconds = max(0, seconds)
        remainingSeconds = totalSeconds
        self.onComplete = onComplete
        isRunning = totalSeconds > 0
        isPaused = false
        lastTick = Date()
        if !isRunning {
            fire()
        }
    }

    /// Called on a display-linked cadence while the scene is active.
    func tick(now: Date = Date()) {
        guard isRunning, !isPaused else {
            lastTick = now
            return
        }
        let previous = lastTick ?? now
        let elapsed = max(0, now.timeIntervalSince(previous))
        lastTick = now
        remainingSeconds = max(0, remainingSeconds - elapsed)
        if remainingSeconds <= 0 {
            fire()
        }
    }

    /// Freeze the countdown without losing the remaining time.
    func pause() {
        guard isRunning else { return }
        isPaused = true
        lastTick = nil
    }

    /// Resume from the exact frozen remaining time.
    func resume() {
        guard isRunning else { return }
        isPaused = false
        lastTick = Date()
    }

    func cancel() {
        isRunning = false
        isPaused = false
        onComplete = nil
        lastTick = nil
    }

    /// Completes an optional presentation wait immediately without cancelling
    /// the already-selected poker action. This is the mobile equivalent of the
    /// desktop table's explicit fast-forward control.
    func finish() {
        guard isRunning else { return }
        remainingSeconds = 0
        fire()
    }

    private func fire() {
        isRunning = false
        isPaused = false
        lastTick = nil
        let completion = onComplete
        onComplete = nil
        completion?()
    }
}
