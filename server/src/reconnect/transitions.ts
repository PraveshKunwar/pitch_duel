import {
  initialConnectionState,
  isTerminal,
  opponentSeat,
  type GameSession,
  type PlayerSeat,
  type SessionOutcome,
} from "../ws/gameSessions";

export type DisconnectResult =
  | { kind: "ignored"; reason: string }
  | { kind: "disconnected"; session: GameSession }
  | { kind: "abandoned"; session: GameSession };

export type ReconnectResult =
  | { kind: "rejected"; reason: string }
  | { kind: "alreadyConnected"; session: GameSession }
  | { kind: "reconnected"; session: GameSession };

export type ExpirationResult =
  | { kind: "ignored"; reason: string }
  | { kind: "forfeited"; session: GameSession }
  | { kind: "abandoned"; session: GameSession };

function endSession(
  session: GameSession,
  outcome: SessionOutcome,
  at: number,
): GameSession {
  return {
    ...session,
    state: {
      ...session.state,
      status: outcome.kind === "abandoned" ? session.state.status : "finished",
    },
    deadlineMs: null,
    pausedRemainingMs: null,
    frozen: false,
    endedAtMs: at,
    outcome,
    connections: {
      player1: {
        ...session.connections.player1,
        gracePeriodExpiresAt: null,
      },
      player2: {
        ...session.connections.player2,
        gracePeriodExpiresAt: null,
      },
    },
  };
}

function freezeForDisconnect(
  session: GameSession,
  at: number,
): Pick<GameSession, "frozen" | "deadlineMs" | "pausedRemainingMs"> {
  if (session.frozen) {
    return {
      frozen: true,
      deadlineMs: session.deadlineMs,
      pausedRemainingMs: session.pausedRemainingMs,
    };
  }
  const remaining =
    session.deadlineMs !== null
      ? Math.max(0, session.deadlineMs - at)
      : null;
  return {
    frozen: true,
    deadlineMs: null,
    pausedRemainingMs: remaining,
  };
}

export function applyDisconnect(
  session: GameSession,
  seat: PlayerSeat,
  connectionId: string | null,
  at: number,
  gracePeriodMs: number,
): DisconnectResult {
  if (isTerminal(session)) {
    return { kind: "ignored", reason: "Game already ended" };
  }

  const current = session.connections[seat];
  if (
    connectionId !== null &&
    current.connectionId !== null &&
    current.connectionId !== connectionId
  ) {
    return { kind: "ignored", reason: "Stale connection" };
  }
  if (!current.connected && current.gracePeriodExpiresAt !== null) {
    return { kind: "ignored", reason: "Already disconnected" };
  }

  const frozen = freezeForDisconnect(session, at);
  const updated: GameSession = {
    ...session,
    ...frozen,
    connections: {
      ...session.connections,
      [seat]: {
        connected: false,
        connectionId: null,
        disconnectedAt: at,
        gracePeriodExpiresAt: at + gracePeriodMs,
      },
    },
  };

  const other = updated.connections[opponentSeat(seat)];
  // Only abandon once both seats have actually disconnected (not merely
  // "not yet joined").
  if (!other.connected && other.disconnectedAt !== null) {
    return {
      kind: "abandoned",
      session: endSession(updated, { kind: "abandoned" }, at),
    };
  }

  return { kind: "disconnected", session: updated };
}

export function applyReconnect(
  session: GameSession,
  seat: PlayerSeat,
  connectionId: string,
  at: number,
): ReconnectResult {
  if (isTerminal(session)) {
    return { kind: "rejected", reason: "Game already ended" };
  }

  const current = session.connections[seat];
  if (current.connected && current.connectionId === connectionId) {
    return { kind: "alreadyConnected", session };
  }

  if (
    current.connected &&
    current.connectionId !== null &&
    current.connectionId !== connectionId
  ) {
    // Newer socket taking over an already-connected seat (refresh).
  } else if (!current.connected) {
    if (
      current.gracePeriodExpiresAt !== null &&
      at >= current.gracePeriodExpiresAt
    ) {
      return { kind: "rejected", reason: "Grace period expired" };
    }
  }

  const other = session.connections[opponentSeat(seat)];
  const stillFrozen = !other.connected;
  const resumeDeadline =
    !stillFrozen && session.pausedRemainingMs !== null
      ? at + session.pausedRemainingMs
      : stillFrozen
        ? null
        : session.deadlineMs;

  const updated: GameSession = {
    ...session,
    frozen: stillFrozen,
    deadlineMs: resumeDeadline,
    pausedRemainingMs: stillFrozen ? session.pausedRemainingMs : null,
    connections: {
      ...session.connections,
      [seat]: {
        connected: true,
        connectionId,
        disconnectedAt: null,
        gracePeriodExpiresAt: null,
      },
    },
  };

  return { kind: "reconnected", session: updated };
}

export function applyGraceExpired(
  session: GameSession,
  seat: PlayerSeat,
  at: number,
): ExpirationResult {
  if (isTerminal(session)) {
    return { kind: "ignored", reason: "Game already ended" };
  }

  const current = session.connections[seat];
  if (current.connected) {
    return { kind: "ignored", reason: "Player is connected" };
  }
  if (
    current.gracePeriodExpiresAt === null ||
    at < current.gracePeriodExpiresAt
  ) {
    return { kind: "ignored", reason: "Grace period has not expired" };
  }

  const other = session.connections[opponentSeat(seat)];
  if (!other.connected) {
    return {
      kind: "abandoned",
      session: endSession(session, { kind: "abandoned" }, at),
    };
  }

  const winner = opponentSeat(seat);
  return {
    kind: "forfeited",
    session: endSession(
      session,
      { kind: "forfeit", winner, forfeitedBy: seat },
      at,
    ),
  };
}

export function bindConnection(
  session: GameSession,
  seat: PlayerSeat,
  connectionId: string,
): GameSession {
  return {
    ...session,
    connections: {
      ...session.connections,
      [seat]: {
        ...initialConnectionState(true),
        connectionId,
      },
    },
  };
}
