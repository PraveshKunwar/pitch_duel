import { useEffect, useState } from "react";
import type { GameClientState } from "../hooks/useGameSocket";
import type {
  Card as CardType,
  GameMode,
  PlayerSeat,
  StatCategory,
  Tactic,
} from "../types/game";
import { MODE_META, TACTIC_META } from "../game/modes";
import { categoryLabel, formatElo, initials } from "../lib/format";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";
import { Card } from "./Card";
import { MatchEndScreen } from "./MatchEndScreen";
import { PlayerHand } from "./PlayerHand";
import { RoundHistory } from "./RoundHistory";

type Props = {
  state: GameClientState;
  mode?: "ranked" | "local";
  gameMode?: GameMode;
  regulationRounds?: number;
  suddenDeath?: boolean;
  tactics?: { you: Tactic; opponent: Tactic } | null;
  onSubmitPick: (cardId: string) => void;
  onBackToLobby: () => void;
  onHome: () => void;
};

function connectionLabel(state: GameClientState): {
  text: string;
  tone: "ok" | "warn" | "bad";
} {
  switch (state.connection) {
    case "connecting":
      return { text: "Connecting…", tone: "warn" };
    case "reconnecting":
      return { text: "Reconnecting…", tone: "warn" };
    case "opponent_disconnected":
      return { text: "Opponent reconnecting…", tone: "warn" };
    case "match_resumed":
      return { text: "Match resumed", tone: "ok" };
    case "opponent_forfeited":
      return { text: "Opponent forfeited", tone: "ok" };
    case "match_abandoned":
      return { text: "Match abandoned", tone: "bad" };
    case "match_completed":
      return { text: "Full time", tone: "ok" };
    case "connected":
      return { text: "Connected", tone: "ok" };
    default:
      return { text: "Online", tone: "ok" };
  }
}

function scoreFor(
  state: GameClientState,
  seat: PlayerSeat | null,
): { you: number; opponent: number } {
  if (state.match) {
    return {
      you: state.match.you.score,
      opponent: state.match.opponent.score,
    };
  }
  if (!seat) {
    return { you: state.privateState?.score ?? 0, opponent: 0 };
  }
  const you = state.history.filter((r) => r.result.winner === seat).length;
  const opponent = state.history.filter((r) => r.result.winner !== seat).length;
  return { you, opponent };
}

function cardStat(card: CardType, category: StatCategory): number {
  if (category === "attack") return card.attack;
  if (category === "defending") return card.defending;
  return card.passing;
}

function battleHint(category: StatCategory | null): string {
  if (category === "attack") {
    return "Pick your strongest attacker. Your opponent won’t see your choice.";
  }
  if (category === "defending") {
    return "Pick your strongest defender. Your opponent won’t see your choice.";
  }
  if (category === "passing") {
    return "Pick your best passer. Your opponent won’t see your choice.";
  }
  return "Waiting for this round’s category.";
}

export function GameBoard({
  state,
  mode = "ranked",
  gameMode = "classic",
  regulationRounds = 5,
  suddenDeath = false,
  tactics = null,
  onSubmitPick,
  onBackToLobby,
  onHome,
}: Props) {
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const yourSeat = state.match?.yourSeat ?? "player1";
  const scores = scoreFor(state, yourSeat);
  const youName = state.match?.you.username ?? "You";
  const oppName =
    state.match?.opponent.username ?? state.opponentUsername ?? "Opponent";
  const youRating = state.match?.you.rating ?? null;
  const oppRating = state.match?.opponent.rating ?? state.opponentRating;
  const conn = connectionLabel(state);
  const modeTitle =
    mode === "local" ? MODE_META[gameMode].title : "Ranked match";

  const ended =
    Boolean(state.endedReason) ||
    state.match?.status === "finished" ||
    state.match?.status === "forfeited" ||
    state.match?.status === "abandoned";

  const displayRound = ended
    ? Math.max(regulationRounds, state.history.length)
    : Math.max(state.round, state.history.length + 1);

  const roundLabel = suddenDeath
    ? "SUDDEN DEATH"
    : `ROUND ${String(displayRound).padStart(2, "0")} / ${String(regulationRounds).padStart(2, "0")}`;

  const serverLocked = Boolean(state.privateState?.selectedCardId);
  const pickingDisabled =
    ended ||
    state.match?.frozen ||
    state.connection === "reconnecting" ||
    state.connection === "connecting";
  const pickLocked = serverLocked || state.pickPending;
  const selectedCardId = state.privateState?.selectedCardId ?? localSelection;

  useEffect(() => {
    setLocalSelection(null);
    setShowRoundResult(false);
  }, [state.round, state.gameId]);

  useEffect(() => {
    if (serverLocked) setLocalSelection(null);
  }, [serverLocked]);

  useEffect(() => {
    if (state.lastRoundResult && !ended) setShowRoundResult(true);
  }, [state.lastRoundResult, ended]);

  const last = state.lastRoundResult;
  const yourLastCard =
    last && yourSeat === "player1"
      ? last.card1
      : last
        ? last.card2
        : null;
  const oppLastCard =
    last && yourSeat === "player1"
      ? last.card2
      : last
        ? last.card1
        : null;
  const youWonRound = last
    ? last.result.winner === yourSeat
    : false;
  const roundDrawn = last ? last.result.winner === null : false;

  const youWonMatch =
    state.endedWinner != null
      ? state.endedWinner === yourSeat
      : scores.you > scores.opponent;

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!state.deadlineMs || state.match?.frozen || ended) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [state.deadlineMs, state.match?.frozen, ended]);

  const secondsLeft =
    state.deadlineMs && !state.match?.frozen
      ? Math.max(0, Math.ceil((state.deadlineMs - Date.now()) / 1000))
      : null;

  const oppCardsLeft =
    mode === "local"
      ? (state.privateState?.hand.length ?? 0)
      : Math.max(0, 5 - state.history.length);

  if (ended) {
    const outcome =
      state.endedReason === "abandoned" || state.match?.status === "abandoned"
        ? "abandoned"
        : youWonMatch
          ? "win"
          : "loss";
    return (
      <MatchEndScreen
        outcome={outcome}
        mode={mode}
        gameMode={gameMode}
        youName={youName}
        oppName={oppName}
        youScore={scores.you}
        oppScore={scores.opponent}
        youRating={youRating}
        oppRating={oppRating}
        history={state.history}
        yourSeat={yourSeat}
        reason={state.endedReason}
        onHome={onHome}
        onLobby={onBackToLobby}
      />
    );
  }

  if (showRoundResult && last && yourLastCard && oppLastCard) {
    return (
      <section className="screen">
        <div className="nav-actions">
          <NavIconButton label="Home" onClick={onHome}>
            <HomeIcon />
          </NavIconButton>
          <NavIconButton
            label="Back to match"
            onClick={() => setShowRoundResult(false)}
          >
            <BackIcon />
          </NavIconButton>
        </div>
        <div className="panel center-panel">
          <span className="eyebrow">
            {last.round > regulationRounds ? "Sudden death" : `Round ${String(last.round).padStart(2, "0")}`}{" "}
            result · {categoryLabel(last.category)}
          </span>
          <h1
            className={
              roundDrawn ? undefined : youWonRound ? "win" : "loss"
            }
          >
            {roundDrawn
              ? "Round drawn."
              : youWonRound
                ? "You take the round."
                : "Round goes to them."}
          </h1>
          <p>
            {roundDrawn
              ? "Category and secondary stats tied — no point awarded."
              : `${categoryLabel(last.category)} was the deciding category.`}
          </p>
          <div className="result-cards">
            <Card
              card={yourLastCard}
              highlightCategory={last.category}
              selectable={false}
            />
            <span className="versus">VS</span>
            <Card
              card={oppLastCard}
              highlightCategory={last.category}
              selectable={false}
            />
          </div>
          <div
            className="row between"
            style={{ maxWidth: 480, margin: "0 auto" }}
          >
            <div>
              <small>
                {youName} · {categoryLabel(last.category)}
              </small>
              <h2
                className={
                  roundDrawn ? undefined : youWonRound ? "win" : undefined
                }
              >
                {cardStat(yourLastCard, last.category)}
              </h2>
            </div>
            <div>
              <small>Match score</small>
              <h2>
                {scores.you} : {scores.opponent}
              </h2>
            </div>
            <div>
              <small>
                {oppName} · {categoryLabel(last.category)}
              </small>
              <h2
                className={
                  roundDrawn ? undefined : !youWonRound ? "loss" : undefined
                }
              >
                {cardStat(oppLastCard, last.category)}
              </h2>
            </div>
          </div>
          <div className="divider" />
          <button
            type="button"
            className="btn"
            onClick={() => setShowRoundResult(false)}
          >
            Continue
          </button>
        </div>
      </section>
    );
  }

  if (pickLocked) {
    return (
      <section className="screen">
        <div className="nav-actions">
          <NavIconButton label="Home" onClick={onHome}>
            <HomeIcon />
          </NavIconButton>
        </div>
        <div className="panel center-panel">
          <span className="eyebrow">
            {roundLabel}
            {state.category ? ` · ${categoryLabel(state.category)}` : ""}
          </span>
          <h1>Your pick is locked.</h1>
          <p>Waiting for {oppName} to choose a card.</p>
          {conn.tone !== "ok" ? (
            <div className="notice">{conn.text}</div>
          ) : null}
          <div className="waiting-box">
            Selection submitted · opponent’s card remains hidden
          </div>
          {secondsLeft !== null ? (
            <small>{secondsLeft}s left on the round timer</small>
          ) : null}
          {state.error ? (
            <div className="alert" role="alert">
              {state.error}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="nav-actions">
        <NavIconButton label="Home" onClick={onHome}>
          <HomeIcon />
        </NavIconButton>
      </div>

      <div className="row between">
        <div>
          <span className="eyebrow">{modeTitle}</span>
          <h2>
            {suddenDeath ? "Sudden death." : "The battle is on."}
          </h2>
        </div>
        <span className="pill">
          <span
            className={`dot ${conn.tone === "warn" ? "warn" : conn.tone === "bad" ? "bad" : ""}`}
          />
          {mode === "local" ? "Vs computer" : conn.text}
        </span>
      </div>

      {tactics ? (
        <div className="notice" style={{ marginTop: 16 }}>
          Your tactic: {TACTIC_META[tactics.you].title} · CPU:{" "}
          {TACTIC_META[tactics.opponent].title}
        </div>
      ) : null}

      {state.error ? (
        <div className="alert" role="alert">
          {state.error}
        </div>
      ) : null}

      {(state.connection === "reconnecting" ||
        state.connection === "opponent_disconnected" ||
        state.connection === "match_resumed") &&
        mode === "ranked" && (
          <div className="notice" style={{ marginTop: 16 }}>
            {state.connection === "reconnecting" &&
              "Reconnecting… card selection is paused."}
            {state.connection === "opponent_disconnected" &&
              "Opponent disconnected. The match is paused until they return."}
            {state.connection === "match_resumed" && "Match restored. You’re back in."}
          </div>
        )}

      <div className="arena">
        <div className="scoreboard">
          <div className="identity">
            <div className="avatar">{initials(youName)}</div>
            <div>
              <h3>
                {youName} <small>YOU</small>
              </h3>
              <small>
                {mode === "local"
                  ? "Local"
                  : `${formatElo(youRating)} ELO`}
              </small>
            </div>
          </div>
          <div className="score">
            <b>
              {scores.you} : {scores.opponent}
            </b>
            <small>{roundLabel}</small>
          </div>
          <div className="identity right">
            <div>
              <h3>{oppName}</h3>
              <small>
                {mode === "local"
                  ? "CPU"
                  : `${formatElo(oppRating)} ELO`}
              </small>
            </div>
            <div className="avatar rival">{initials(oppName)}</div>
          </div>
        </div>

        <div
          className="hidden-hand"
          aria-label={`Opponent has ${oppCardsLeft} hidden cards`}
        >
          {Array.from({ length: oppCardsLeft }, (_, i) => (
            <div key={i} className="card-back" aria-hidden="true">
              S
            </div>
          ))}
        </div>

        <div className="battle">
          <span className="eyebrow">This round’s category</span>
          <h2 className="stat-name">
            {state.category ? categoryLabel(state.category) : "…"}
          </h2>
          <p>
            {battleHint(state.category)}
            {secondsLeft !== null ? ` · ${secondsLeft}s left` : ""}
          </p>
        </div>

        {state.privateState ? (
          <PlayerHand
            cards={state.privateState.hand}
            selectedCardId={selectedCardId}
            locked={pickLocked}
            disabled={Boolean(pickingDisabled)}
            category={state.category}
            onSelect={setLocalSelection}
            onSubmit={() => {
              if (!localSelection) return;
              onSubmitPick(localSelection);
            }}
          />
        ) : (
          <div className="notice">Loading hand…</div>
        )}
      </div>

      <RoundHistory
        history={state.history}
        yourSeat={yourSeat}
        currentRound={displayRound}
        currentCategory={state.category}
        ended={false}
        regulationRounds={regulationRounds}
        suddenDeath={suddenDeath}
      />

      <div className="footer-note">
        <span>
          {suddenDeath
            ? "First round win ends the match."
            : "Your selections stay hidden until both players lock in."}
        </span>
      </div>
    </section>
  );
}
