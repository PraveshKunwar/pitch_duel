import {
  recordFinishedMatch,
  type FinishedMatch,
  type RecordedMatch,
} from "../db/matches";
import { summarizeMatch } from "../game/matchResult";
import type { GameSession, GameSessionStore } from "./gameSessions";

export interface PendingRecovery {
  recovered: string[];
  failed: Array<{ gameId: string; error: unknown }>;
  lost: string[];
}

export interface MatchFinalizer {
  finalize(session: GameSession): Promise<RecordedMatch>;
  recoverPending(): Promise<PendingRecovery>;
}

export interface MatchFinalizerDependencies {
  sessions: GameSessionStore;
  recordMatch?: (match: FinishedMatch) => Promise<RecordedMatch>;
}

export function toFinishedMatch(session: GameSession): FinishedMatch {
  const summary = summarizeMatch(session.state);
  return {
    gameId: session.id,
    player1Id: session.player1UserId,
    player2Id: session.player2UserId,
    winner: summary.winner,
    startedAt: new Date(session.startedAtMs),
    endedAt: new Date(session.endedAtMs ?? Date.now()),
    rounds: summary.rounds,
  };
}

export function createMatchFinalizer(
  deps: MatchFinalizerDependencies,
): MatchFinalizer {
  const recordMatch =
    deps.recordMatch ?? ((match: FinishedMatch) => recordFinishedMatch(match));

  async function finalize(session: GameSession): Promise<RecordedMatch> {
    const recorded = await recordMatch(toFinishedMatch(session));
    await deps.sessions.markPersisted(session.id, [
      session.player1UserId,
      session.player2UserId,
    ]);
    return recorded;
  }

  async function recoverPending(): Promise<PendingRecovery> {
    const outcome: PendingRecovery = { recovered: [], failed: [], lost: [] };
    for (const gameId of await deps.sessions.unpersisted()) {
      try {
        const session = await deps.sessions.get(gameId);
        if (!session) {
          await deps.sessions.markPersisted(gameId);
          outcome.lost.push(gameId);
          continue;
        }
        await finalize(session);
        outcome.recovered.push(gameId);
      } catch (error) {
        outcome.failed.push({ gameId, error });
      }
    }
    return outcome;
  }

  return { finalize, recoverPending };
}
