import { useEffect, useRef, useState } from "react";
import { formatChips } from "./format";
import { formatMessage } from "./localeMessages";
import type { PokerAction } from "../types/poker";

export type AnnouncementPriority = "polite" | "assertive";

export interface TableAnnouncement {
  /** Stable per-transition id, useful for React keys/log de-duplication. */
  id: string;
  text: string;
  priority: AnnouncementPriority;
}

export interface TablePotResultSnapshot {
  /** Public hand id, used to announce a result exactly once at showdown. */
  id: string;
  /** Display names already resolved to "You" for the hero, exactly as the
   *  visible seat labels read -- never a raw internal identifier and never
   *  inferred from hidden cards. */
  winnerNames: readonly string[];
  /** Total chips actually awarded across every pot the winners took, sourced
   *  from the engine's real per-player pot awards (never guessed from a
   *  stack-size delta). */
  amount: number;
  /** True only when the resolved hand's award set spans more than one
   *  contestable pot (a genuine side pot), sourced from the engine's real
   *  pot-building result -- never fabricated. */
  hadSidePot: boolean;
}

/**
 * A minimal, purely-comparable snapshot of table state relevant to LIVE
 * announcements (as opposed to the static structural SR semantics already on
 * PlayerSeat/PlayingCard/community-cards). Every field the diff below reads
 * is public information the visual table already discloses; nothing here
 * exposes a hidden opponent card or any information-set the player could not
 * already see or infer from the felt.
 */
export interface TableAnnouncerSnapshot {
  /** Current big blind/small blind. Compared only to detect a LEVEL CHANGE
   *  between snapshots (Timed Table / tournament blind schedule) -- never
   *  read as a running per-second countdown. */
  bigBlind: number;
  smallBlind: number;
  /** 1-indexed hand number, when a tournament/Timed Table backs the table. */
  handNumber?: number;
  /** The hero's own action for the CURRENT hand, or null before acting. */
  heroAction: PokerAction | null;
  /** The hero's true all-in amount, computed the same way the raise/all-in
   *  controls already compute it -- only read when `heroAction` is
   *  "all-in". */
  heroAllInAmount?: number;
  /** The newest public action-history entry, i.e. exactly the text the hand
   *  history popover already shows -- never hidden opponent information. */
  latestPublicAction?: string;
  /** The most recently resolved hand's public result, or undefined before
   *  any hand has finished this table mount. */
  potResult?: TablePotResultSnapshot;
}

function isAllInEntry(entry: string | undefined): boolean {
  return Boolean(entry) && /all-in/i.test(entry as string);
}

/**
 * Pure diff between two consecutive snapshots. Every returned entry is a
 * genuine STATE TRANSITION, never a repeated value -- calling this every
 * render with an unchanged snapshot always returns `[]`. That is the
 * no-spam/coalescing guarantee, and it lives here so it is unit-testable
 * without any UI: a slider or countdown re-rendering many times a second
 * never appears in `TableAnnouncerSnapshot`, so it can never produce an
 * announcement no matter how often this runs.
 *
 * Assertive priority is reserved for the two interruption-worthy events this
 * module owns: the hero's own all-in and a publicly visible opponent all-in.
 * Illegal-action and math-entry errors are deliberately NOT duplicated here
 * -- PokerTable already surfaces them through native `role="alert"`
 * elements, which are themselves assertive live regions. Re-announcing the
 * same text through a second channel would speak it twice.
 */
export function deriveTableAnnouncements(
  previous: TableAnnouncerSnapshot | null,
  next: TableAnnouncerSnapshot,
): TableAnnouncement[] {
  if (!previous) return [];
  const announcements: TableAnnouncement[] = [];

  // --- Timers: a blind-level increase (Timed Table / tournament structure).
  // Deliberately NOT a running countdown -- only a genuine level change.
  if (next.bigBlind !== previous.bigBlind && next.bigBlind > previous.bigBlind) {
    announcements.push({
      id: `blinds-${next.bigBlind}`,
      priority: "polite",
      text: formatMessage("table.announce.blindsIncreased", {
        smallBlind: formatChips(next.smallBlind),
        bigBlind: formatChips(next.bigBlind),
      }),
    });
  }

  // --- Results: a public result is announced exactly once when the showdown
  // event reaches the table. The same id carries into the next hand without
  // repeating the message.
  if (
    next.potResult &&
    next.potResult.winnerNames.length > 0 &&
    next.potResult.id !== previous.potResult?.id
  ) {
    const { winnerNames, amount, hadSidePot } = next.potResult;
    const names = winnerNames.join(
      winnerNames.length > 1 ? formatMessage("table.announce.namesJoiner") : "",
    );
    announcements.push({
      id: `result-${next.potResult.id}`,
      priority: "polite",
      text: [
        formatMessage(
          winnerNames.length > 1
            ? "table.announce.handWinnerSplit"
            : "table.announce.handWinner",
          { names, amount: formatChips(amount) },
        ),
        hadSidePot ? formatMessage("table.announce.sidePotFormed") : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  // --- All-in: the hero's own decision escalates first; a simultaneous
  // opponent all-in in the same transition is never double-fired alongside
  // it (the hero's own moment takes priority for that transition).
  const heroJustWentAllIn =
    previous.heroAction !== "all-in" && next.heroAction === "all-in";
  if (heroJustWentAllIn) {
    announcements.push({
      id: `hero-all-in-${next.handNumber ?? "training"}`,
      priority: "assertive",
      text: formatMessage("table.announce.heroAllIn", {
        amount: formatChips(next.heroAllInAmount ?? 0),
      }),
    });
  } else if (
    next.latestPublicAction &&
    next.latestPublicAction !== previous.latestPublicAction &&
    isAllInEntry(next.latestPublicAction)
  ) {
    announcements.push({
      id: `public-all-in-${next.latestPublicAction}`,
      priority: "assertive",
      text: formatMessage("table.announce.publicAllIn", {
        action: next.latestPublicAction,
      }),
    });
  }

  return announcements;
}

/**
 * Coalesces same-transition announcements of the same priority into one
 * spoken string, so simultaneous events read as a single sentence instead of
 * two back-to-back live-region mutations, and remembers the last snapshot so
 * repeated calls with unchanged state never re-announce anything. Framework
 * -free and directly unit-testable.
 */
export class TableAnnouncerController {
  private previous: TableAnnouncerSnapshot | null = null;
  private polite = "";
  private assertive = "";

  update(next: TableAnnouncerSnapshot): { polite: string; assertive: string } {
    const announcements = deriveTableAnnouncements(this.previous, next);
    this.previous = next;
    const polite = announcements
      .filter((entry) => entry.priority === "polite")
      .map((entry) => entry.text)
      .join(" ");
    const assertive = announcements
      .filter((entry) => entry.priority === "assertive")
      .map((entry) => entry.text)
      .join(" ");
    if (polite) this.polite = polite;
    if (assertive) this.assertive = assertive;
    return { polite: this.polite, assertive: this.assertive };
  }

  /** Returns the last-announced text for each channel without recomputing. */
  current(): { polite: string; assertive: string } {
    return { polite: this.polite, assertive: this.assertive };
  }

  reset(): void {
    this.previous = null;
    this.polite = "";
    this.assertive = "";
  }
}

/**
 * Binds a `TableAnnouncerController` to React state so PokerTable can render
 * its current polite/assertive text. This hook itself needs a renderer to
 * exercise (this repo's Vitest setup has no DOM environment/@testing-library
 * available), so it is intentionally a thin, side-effect-only wrapper: every
 * decision it makes is delegated to `deriveTableAnnouncements` /
 * `TableAnnouncerController` above, which are fully unit-tested without one.
 */
export function useTableAnnouncer(snapshot: TableAnnouncerSnapshot): {
  politeMessage: string;
  assertiveMessage: string;
} {
  const controllerRef = useRef<TableAnnouncerController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TableAnnouncerController();
  }
  const [messages, setMessages] = useState({ polite: "", assertive: "" });

  // No dependency array: `snapshot` is a small plain object rebuilt every
  // render, and the controller's own diff (against the PREVIOUS snapshot it
  // stored, not React's dependency identity) is what decides whether
  // anything changed. Running this after every render is cheap and correct
  // -- it returns the same strings, and `setMessages` bails out below,
  // whenever nothing meaningful changed.
  useEffect(() => {
    const next = controllerRef.current!.update(snapshot);
    setMessages((current) =>
      current.polite === next.polite && current.assertive === next.assertive
        ? current
        : next,
    );
  });

  return {
    politeMessage: messages.polite,
    assertiveMessage: messages.assertive,
  };
}
