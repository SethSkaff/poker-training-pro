import type { BettingActionCommand } from "../../src/engine/betting";
import {
  chooseTournamentSessionPolicyAction,
  type SessionPolicyDecision,
  type SessionPolicyOptions,
  type TournamentSession,
} from "../../src/modes/tournamentSession";

export type EvaluationPolicyMode = "normal" | "rational" | "scripted";

export interface EvaluationPolicyAdapter {
  id: string;
  mode: EvaluationPolicyMode;
  choose(session: TournamentSession, playerId: string): BettingActionCommand;
  decide?(session: TournamentSession, playerId: string): SessionPolicyDecision;
}

export function evaluatePolicyAtNode(
  session: TournamentSession,
  playerId: string,
  options: SessionPolicyOptions = {},
): SessionPolicyDecision {
  return chooseTournamentSessionPolicyAction(session, playerId, options);
}

export function createProductionPolicyAdapter(
  mode: "normal" | "rational",
  options: SessionPolicyOptions = {},
): EvaluationPolicyAdapter {
  return {
    id: `production-${mode}`,
    mode,
    decide(session, playerId) {
      if (session.mode !== mode) {
        throw new Error(`Policy adapter ${mode} cannot relabel a ${session.mode} session`);
      }
      return evaluatePolicyAtNode(session, playerId, options);
    },
    choose(session, playerId) {
      return this.decide?.(session, playerId)?.command ?? evaluatePolicyAtNode(session, playerId, options).command;
    },
  };
}

export function createScriptedPolicyAdapter(
  id: string,
  chooseCommand: (session: TournamentSession, playerId: string) => BettingActionCommand,
): EvaluationPolicyAdapter {
  return {
    id,
    mode: "scripted",
    choose: chooseCommand,
  };
}
