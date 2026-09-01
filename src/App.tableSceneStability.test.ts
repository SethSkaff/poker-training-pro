import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const appSource = () => readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");
const tableSource = () =>
  readFileSync(path.join(sourceRoot, "components", "PokerTable.tsx"), "utf8");

describe("tournament table scene identity", () => {
  it("keeps the Training table mounted when advancing to the next hand", () => {
    const app = appSource();
    const start = app.indexOf('if (screen === "practice")');
    const end = app.indexOf('if (screen === "tutorial")', start);
    const practiceRender = app.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(practiceRender).toContain('<PokerTable\n');
    expect(practiceRender).not.toMatch(/<PokerTable\s+key=/);
  });

  it("resets Training hand state before the new scenario paints", () => {
    const table = tableSource();

    expect(table).toContain("useLayoutEffect");
    expect(table).toContain("previousTrainingScenarioIdRef");
    expect(table).toContain("setStagedBoard(scenario.board.map");
    expect(table).toContain("setCardsDealtHandId(scenario.id)");
  });

  it("does not key the tournament table on advancing poker state", () => {
    const app = appSource();
    const start = app.indexOf('if (screen === "tournament-table" && runner && !tournamentResult)');
    const end = app.indexOf("if (tournamentResult)", start);
    const tournamentRender = app.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(tournamentRender).toContain("sceneStateVersion: runner.sequence");
    expect(tournamentRender).not.toMatch(/<PokerTable\s+key=/);
    expect(tournamentRender).not.toContain("snapshot.street,");
    expect(tournamentRender).not.toContain("snapshot.pot,");
  });

  it("uses an update revision for explicit transient resets while retaining one DOM table", () => {
    const table = tableSource();
    expect(table).toContain("planTableSceneUpdate(");
    expect(table).toContain("actionGateRef.current.release()");
    expect(table).toContain('data-table-hand-id={scenario.id}');
    expect(table).toContain('"data-table-state-version": tournament.sceneStateVersion');
    expect(table).not.toContain("key={[");
  });

  it("switches to the viewer-safe next-hand snapshot when the deal begins", () => {
    const app = appSource();
    expect(app).toContain('presentationEvent?.kind === "hole-cards-dealt"');
    expect(app).toContain("pendingPresentation.next.session.activeHand?.handId");
    expect(app).toContain("createPokerTableSnapshot(pendingPresentation.next.session)");
    expect(app).toContain("scenario={snapshotForPresentation}");
  });
});
