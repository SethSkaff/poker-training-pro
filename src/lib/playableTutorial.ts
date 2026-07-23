export type TutorialStep =
  | "peek"
  | "legal-action"
  | "bet-sizing"
  | "showdown"
  | "math"
  | "speed"
  | "complete";

export interface PlayableTutorialState {
  step: TutorialStep;
  cardsPeeked: boolean;
  betSize: number;
  runoutCards: number;
  presentationSpeed: number;
}

export type PlayableTutorialCommand =
  | { type: "peek" }
  | { type: "choose-action"; action: "fold" | "check" | "raise" }
  | { type: "set-bet"; amount: number }
  | { type: "confirm-bet" }
  | { type: "wait-for-card" }
  | { type: "continue-math" }
  | { type: "set-speed"; speed: number }
  | { type: "finish" }
  | { type: "restart" };

export const TUTORIAL_MIN_BET = 400;
export const TUTORIAL_MAX_BET = 1_200;

export function createPlayableTutorial(): PlayableTutorialState {
  return {
    step: "peek",
    cardsPeeked: false,
    betSize: TUTORIAL_MIN_BET,
    runoutCards: 0,
    presentationSpeed: 1,
  };
}

/**
 * A deliberately small, deterministic practice hand. Commands that are not
 * legal for the current lesson leave the state unchanged, just as table
 * controls are disabled when an action is unavailable.
 */
export function advancePlayableTutorial(
  state: PlayableTutorialState,
  command: PlayableTutorialCommand,
): PlayableTutorialState {
  if (command.type === "restart") return createPlayableTutorial();

  if (state.step === "peek" && command.type === "peek") {
    return { ...state, cardsPeeked: true, step: "legal-action" };
  }

  if (
    state.step === "legal-action" &&
    command.type === "choose-action" &&
    command.action === "check"
  ) {
    return { ...state, step: "bet-sizing" };
  }

  if (state.step === "bet-sizing" && command.type === "set-bet") {
    const amount = Math.max(
      TUTORIAL_MIN_BET,
      Math.min(TUTORIAL_MAX_BET, Math.round(command.amount / 100) * 100),
    );
    return { ...state, betSize: amount };
  }

  if (state.step === "bet-sizing" && command.type === "confirm-bet") {
    return { ...state, step: "showdown" };
  }

  if (state.step === "showdown" && command.type === "wait-for-card") {
    const runoutCards = Math.min(2, state.runoutCards + 1);
    return {
      ...state,
      runoutCards,
      step: runoutCards === 2 ? "math" : "showdown",
    };
  }

  if (state.step === "math" && command.type === "continue-math") {
    return { ...state, step: "speed" };
  }

  if (state.step === "speed" && command.type === "set-speed") {
    const presentationSpeed = Math.max(0.5, Math.min(3, command.speed));
    return {
      ...state,
      presentationSpeed,
      step: presentationSpeed === 1 ? "speed" : "complete",
    };
  }

  return state;
}

export const TUTORIAL_STEP_ORDER: TutorialStep[] = [
  "peek",
  "legal-action",
  "bet-sizing",
  "showdown",
  "math",
  "speed",
  "complete",
];
