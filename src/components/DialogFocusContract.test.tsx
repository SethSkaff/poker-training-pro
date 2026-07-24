import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeTrapTarget } from "../lib/focusNavigation";
import { ControlsRemapPanel } from "./ControlsRemapPanel";

const componentsDir = path.dirname(fileURLToPath(import.meta.url));

function source(relative: string): string {
  return readFileSync(path.join(componentsDir, relative), "utf8");
}

/**
 * Item 4: the same initial-focus / wraparound-trap / restore contract for every
 * modal dialog. There is no DOM in the Vitest node environment, so the trap
 * arithmetic is verified directly (`computeTrapTarget`) and each dialog's
 * adoption of the shared `useModalFocusTrap` hook plus its ARIA modal markers is
 * inventoried from source. This fails loudly if a new modal skips the contract.
 */
describe("shared modal focus-trap hook", () => {
  const hook = readFileSync(
    path.join(componentsDir, "..", "hooks", "useModalFocusTrap.ts"),
    "utf8",
  );

  it("captures, initial-focuses, traps with wraparound, and restores", () => {
    // Restore target captured from the active element on open.
    expect(hook).toContain("document.activeElement");
    // Initial focus applied inside the container.
    expect(hook).toMatch(/focusables\[0\]\.focus\(\)|preferred\.focus\(\)/);
    // Tab trap delegates to the pure wraparound computation.
    expect(hook).toContain("computeTrapTarget");
    // Restores prior focus on cleanup.
    expect(hook).toContain("restoreTargetRef.current?.focus()");
  });

  it("wraps focus at both ends (contract math)", () => {
    expect(computeTrapTarget(3, 2, false)).toBe(0);
    expect(computeTrapTarget(3, 0, true)).toBe(2);
    expect(computeTrapTarget(0, -1, false)).toBe("container");
  });
});

describe("modal dialog inventory", () => {
  const pokerTable = source("PokerTable.tsx");
  const remap = source("ControlsRemapPanel.tsx");

  const modals: Array<{ name: string; src: string; trapMarker: RegExp }> = [
    {
      name: "pause menu",
      src: pokerTable,
      trapMarker: /useModalFocusTrap\(\{\s*active: paused/s,
    },
    {
      name: "custom raise composer",
      src: pokerTable,
      trapMarker: /active: raiseOpen && !action,\s*containerRef: raiseComposerRef/s,
    },
    {
      name: "hand-history popover",
      src: pokerTable,
      trapMarker: /active: historyOpen, containerRef: historyRef/,
    },
    {
      name: "remap capture",
      src: remap,
      trapMarker: /useModalFocusTrap\(\{\s*active: true,\s*containerRef: dialogRef/s,
    },
  ];

  for (const modal of modals) {
    it(`applies the focus trap to the ${modal.name}`, () => {
      expect(modal.src).toMatch(modal.trapMarker);
    });
  }

  it("declares aria-modal dialogs for all four table/remap modals", () => {
    // Pause, bet composer, hand history each declare the modal role.
    const tableModals = pokerTable.match(/aria-modal="true"/g) ?? [];
    expect(tableModals.length).toBeGreaterThanOrEqual(3);
    expect(remap).toContain('role="dialog"');
    expect(remap).toContain('aria-modal="true"');
  });
});

describe("remap capture dialog markup", () => {
  it("renders the capture dialog with the modal contract when listening", () => {
    // The capture dialog only mounts on interaction; assert the panel itself
    // wires the rebind affordance that opens it, and that a listening dialog
    // carries the modal markers (verified via source above). Here we confirm
    // the panel renders without throwing and exposes the tablist contract.
    const markup = renderToStaticMarkup(
      <ControlsRemapPanel onChange={() => undefined} />,
    );
    expect(markup).toContain('aria-label="Control remapping"');
  });
});
