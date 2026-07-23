import type { TrainingScenario } from "../types/poker";

export type ContextualPromptId =
  | "all-in"
  | "side-pot"
  | "short-stack"
  | "decision-mistake";

export interface ContextualPrompt {
  id: ContextualPromptId;
  title: string;
  message: string;
}

export interface ContextualPromptState {
  enabled: boolean;
  seen: ContextualPromptId[];
}

export const CONTEXTUAL_PROMPTS: Record<
  ContextualPromptId,
  ContextualPrompt
> = {
  "all-in": {
    id: "all-in",
    title: "All-in",
    message:
      "An all-in player cannot wager again. Other players may keep betting if at least two of them still have chips.",
  },
  "side-pot": {
    id: "side-pot",
    title: "Side pot",
    message:
      "Each player can win only the chips they matched. Extra chips form a side pot contested by the deeper stacks.",
  },
  "short-stack": {
    id: "short-stack",
    title: "Short-stack pressure",
    message:
      "At ten big blinds or fewer, blinds consume your stack quickly. Waiting is still a choice, but each orbit makes it more expensive.",
  },
  "decision-mistake": {
    id: "decision-mistake",
    title: "Review the decision",
    message:
      "A mistake is useful evidence. Compare the legal choices and their expected value, then retry the unscored scenario.",
  },
};

const PROMPT_KEY = "poker-training-pro:contextual-prompts:v1";
const IDS = Object.keys(CONTEXTUAL_PROMPTS) as ContextualPromptId[];

export function defaultContextualPromptState(): ContextualPromptState {
  return { enabled: true, seen: [] };
}

export function loadContextualPromptState(): ContextualPromptState {
  if (typeof localStorage === "undefined") {
    return defaultContextualPromptState();
  }
  try {
    const value = JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "{}") as {
      enabled?: unknown;
      seen?: unknown;
    };
    return {
      enabled: value.enabled !== false,
      seen: Array.isArray(value.seen)
        ? value.seen.filter(
            (id): id is ContextualPromptId =>
              typeof id === "string" &&
              IDS.includes(id as ContextualPromptId),
          )
        : [],
    };
  } catch {
    return defaultContextualPromptState();
  }
}

export function saveContextualPromptState(state: ContextualPromptState) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROMPT_KEY, JSON.stringify(state));
  } catch {
    // Coaching remains usable for the current table if storage is unavailable.
  }
}

export function nextContextualPrompt(
  state: ContextualPromptState,
  occurrences: readonly ContextualPromptId[],
): ContextualPrompt | undefined {
  if (!state.enabled) return undefined;
  const id = occurrences.find((candidate) => !state.seen.includes(candidate));
  return id ? CONTEXTUAL_PROMPTS[id] : undefined;
}

export function markContextualPromptSeen(
  state: ContextualPromptState,
  id: ContextualPromptId,
): ContextualPromptState {
  return state.seen.includes(id)
    ? state
    : { ...state, seen: [...state.seen, id] };
}

export function detectTablePromptOccurrences(
  scenario: TrainingScenario,
  actionHistory: readonly string[] = [],
): ContextualPromptId[] {
  const occurrences: ContextualPromptId[] = [];
  const allInPlayers = scenario.players.filter(
    (player) => player.status === "all-in",
  );
  const copy = [
    scenario.prompt,
    scenario.title,
    ...scenario.tags,
    ...actionHistory,
  ]
    .join(" ")
    .toLowerCase();

  if (allInPlayers.length > 0 || copy.includes("all-in")) {
    occurrences.push("all-in");
  }
  if (
    copy.includes("side pot") ||
    copy.includes("side-pot") ||
    (allInPlayers.length >= 2 &&
      new Set(allInPlayers.map((player) => player.bet)).size > 1)
  ) {
    occurrences.push("side-pot");
  }

  const hero = scenario.players.find(
    (player) => player.seat === scenario.heroSeat,
  );
  if (
    hero &&
    scenario.blinds[1] > 0 &&
    (hero.stack + hero.bet) / scenario.blinds[1] <= 10
  ) {
    occurrences.push("short-stack");
  }
  return occurrences;
}
