import { describe, expect, it } from "vitest";
import { createSceneRecoverySession } from "./sceneRecovery";

describe("scene context recovery", () => {
  it("rebuilds from the latest immutable state only after a recoverable loss", () => {
    let latest = { pot: 20 };
    let recoverable = true;
    const attempts: Array<{ state: typeof latest; lost: number; disposed: number }> = [];
    const session = createSceneRecoverySession({
      latestState: () => latest,
      canRecover: () => recoverable,
      create: (state) => {
        const attempt = { state, lost: 0, disposed: 0 };
        attempts.push(attempt);
        return {
          contextLost: () => { attempt.lost += 1; },
          dispose: () => { attempt.disposed += 1; },
        };
      },
    });

    expect(attempts).toHaveLength(1);
    expect(session.contextLost()).toBe(true);
    expect(attempts[0]).toMatchObject({ lost: 1, disposed: 0 });
    latest = { pot: 40 };
    session.contextRestored();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({ state: { pot: 40 } });

    session.dispose();
    session.dispose();
    expect(attempts[1]).toMatchObject({ disposed: 1 });
    recoverable = false;
    expect(session.contextLost()).toBe(false);
  });

  it("does not intercept a context loss that cannot be recovered in place", () => {
    let recoverable = false;
    const session = createSceneRecoverySession({
      latestState: () => 1,
      canRecover: () => recoverable,
      create: () => ({ contextLost() {}, dispose() {} }),
    });
    expect(session.contextLost()).toBe(false);
    recoverable = true;
    expect(session.contextLost()).toBe(true);
    expect(session.contextLost()).toBe(false);
    session.dispose();
  });
});
