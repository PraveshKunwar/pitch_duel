import {
  recordAbandonedMatch,
  recordFinishedMatch,
  recordForfeitedMatch,
  type AbandonedMatch,
  type FinishedMatch,
  type ForfeitedMatch,
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

export interface LeaderboardSync {
  updateLeaderboardEntries(
    entries: Array<{ userId: string; rating: number }>,
  ): Promise<void>;
}

export interface MatchFinalizerDependencies {
  sessions: GameSessionStore;
  recordMatch?: (match: FinishedMatch) => Promise<RecordedMatch>;
  recordForfeit?: (match: ForfeitedMatch) => Promise<RecordedMatch>;
  recordAbandon?: (match: AbandonedMatch) => Promise<RecordedMatch>;
  leaderboard?: LeaderboardSync;
  onLeaderboardError?: (
    error: unknown,
    context: { gameId: string; userIds: string[] },
  ) => void;
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

export function toForfeitedMatch(session: GameSession): ForfeitedMatch {
  if (session.outcome?.kind !== "forfeit") {
    throw new Error(`Game ${session.id} is not a forfeit`);
  }
  return {
    gameId: session.id,
    player1Id: session.player1UserId,
    player2Id: session.player2UserId,
    winner: session.outcome.winner,
    startedAt: new Date(session.startedAtMs),
    endedAt: new Date(session.endedAtMs ?? Date.now()),
  };
}

export function toAbandonedMatch(session: GameSession): AbandonedMatch {
  return {
    gameId: session.id,
    player1Id: session.player1UserId,
    player2Id: session.player2UserId,
    startedAt: new Date(session.startedAtMs),
    endedAt: new Date(session.endedAtMs ?? Date.now()),
  };
}

export function createMatchFinalizer(
  deps: MatchFinalizerDependencies,
): MatchFinalizer {
  const recordMatch =
    deps.recordMatch ?? ((match: FinishedMatch) => recordFinishedMatch(match));
  const recordForfeit =
    deps.recordForfeit ??
    ((match: ForfeitedMatch) => recordForfeitedMatch(match));
  const recordAbandon =
    deps.recordAbandon ??
    ((match: AbandonedMatch) => recordAbandonedMatch(match));

  async function syncLeaderboard(
    session: GameSession,
    recorded: RecordedMatch,
  ): Promise<void> {
    if (!deps.leaderboard || recorded.status !== "finished") return;
    const entries = [
      {
        userId: session.player1UserId,
        rating: recorded.ratings.player1,
      },
      {
        userId: session.player2UserId,
        rating: recorded.ratings.player2,
      },
    ];
    try {
      await deps.leaderboard.updateLeaderboardEntries(entries);
    } catch (error) {
      // Postgres already committed — never roll back the match for Redis failure.
      deps.onLeaderboardError?.(error, {
        gameId: session.id,
        userIds: [session.player1UserId, session.player2UserId],
      });
    }
  }

  async function finalize(session: GameSession): Promise<RecordedMatch> {
    let recorded: RecordedMatch;
    if (session.outcome?.kind === "abandoned") {
      recorded = await recordAbandon(toAbandonedMatch(session));
    } else if (session.outcome?.kind === "forfeit") {
      recorded = await recordForfeit(toForfeitedMatch(session));
    } else {
      recorded = await recordMatch(toFinishedMatch(session));
    }
    await syncLeaderboard(session, recorded);
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
