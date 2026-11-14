import { useEffect, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DraftBoard } from "./components/DraftBoard";
import { GameBoard } from "./components/GameBoard";
import { Leaderboard } from "./components/Leaderboard";
import { Lobby } from "./components/Lobby";
import { LoginForm } from "./components/LoginForm";
import { Matchmaking } from "./components/Matchmaking";
import { ModeSelect } from "./components/ModeSelect";
import { RegisterForm } from "./components/RegisterForm";
import { TacticSelect } from "./components/TacticSelect";
import { TopBar } from "./components/TopBar";
import { useAuth } from "./hooks/useAuth";
import { useGameSocket } from "./hooks/useGameSocket";
import { useLocalGame } from "./hooks/useLocalGame";
import type { AppScreen, GameMode } from "./types/game";

function topBarActive(
  screen: AppScreen,
  queued = false,
): "lobby" | "game" | "leaderboard" | "auth" | "matchmaking" {
  if (screen === "auth") return "auth";
  if (screen === "leaderboard") return "leaderboard";
  if (queued || screen === "matchmaking" || screen === "mode_select") {
    return "matchmaking";
  }
  if (screen === "game" || screen === "draft" || screen === "tactics") {
    return "game";
  }
  return "lobby";
}

export default function App() {
  const auth = useAuth();
  const [screen, setScreen] = useState<AppScreen>("auth");
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [playMode, setPlayMode] = useState<"none" | "online" | "local">("none");
  const [modeSelectContext, setModeSelectContext] = useState<
    "local" | "ranked"
  >("local");
  const [exitConfirm, setExitConfirm] = useState(false);
  const [leaveQueueConfirm, setLeaveQueueConfirm] = useState(false);
  const online = useGameSocket(Boolean(auth.user));
  const local = useLocalGame(auth.user);

  const queued =
    online.state.matchmaking === "queued" ||
    online.state.matchmaking === "found";
  const queueOverlay =
    queued ||
    online.state.matchmaking === "timeout" ||
    online.state.matchmaking === "cancelled";

  const inOnlineMatch =
    playMode === "online" &&
    Boolean(online.state.gameId) &&
    online.state.endedReason === null;
  const inLocalMatch =
    playMode === "local" &&
    local.active &&
    local.phase === "playing" &&
    local.state.endedReason === null;
  const inLocalSetup =
    playMode === "local" &&
    (local.phase === "selecting_mode" ||
      local.phase === "drafting" ||
      local.phase === "choosing_tactic");
  const inRankedSetup =
    playMode === "online" &&
    (screen === "mode_select" ||
      queued ||
      online.state.phase === "drafting" ||
      online.state.phase === "choosing_tactic");
  const inActiveMatch =
    inOnlineMatch || inLocalMatch || inLocalSetup || inRankedSetup;
  const viewingMatch =
    (playMode === "online" && Boolean(online.state.gameId)) ||
    (playMode === "local" && local.active);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) {
      setScreen("auth");
      setPlayMode("none");
      local.returnToLobby();
      return;
    }

    if (playMode === "local" && local.active) {
      if (local.phase === "selecting_mode") setScreen("mode_select");
      else if (local.phase === "drafting") setScreen("draft");
      else if (local.phase === "choosing_tactic") setScreen("tactics");
      else if (local.phase === "playing") setScreen("game");
      return;
    }

    if (playMode === "online") {
      const mm = online.state.matchmaking;
      // Queue overlay sits on lobby — never bounce away while searching.
      if (mm === "queued" || mm === "found") {
        if (screen !== "lobby" && screen !== "mode_select") {
          setScreen("lobby");
        }
        return;
      }
      if (online.state.gameId && online.state.endedReason === null) {
        if (online.state.phase === "drafting") {
          setScreen("draft");
          return;
        }
        if (online.state.phase === "choosing_tactic") {
          setScreen("tactics");
          return;
        }
        setScreen("game");
        return;
      }
      if (online.state.gameId && online.state.endedReason) {
        setScreen("game");
        return;
      }
      if (screen === "mode_select") return;
      if (screen === "auth" || screen === "matchmaking") {
        setScreen("lobby");
        setPlayMode("none");
      }
      return;
    }

    if (screen === "auth") setScreen("lobby");
  }, [
    auth.loading,
    auth.user,
    playMode,
    local.active,
    local.phase,
    online.state.matchmaking,
    online.state.gameId,
    online.state.endedReason,
    online.state.phase,
    screen,
  ]);

  useEffect(() => {
    if (online.state.yourNewRating != null) {
      auth.applyRating(online.state.yourNewRating);
      return;
    }
    if (online.state.endedReason && playMode === "online") {
      void auth.refreshUser().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online.state.yourNewRating, online.state.endedReason, playMode]);

  const leaveToLobby = () => {
    if (online.state.matchmaking === "queued") {
      online.cancelMatchmaking();
    }
    online.returnToLobby();
    local.returnToLobby();
    setPlayMode("none");
    setExitConfirm(false);
    setLeaveQueueConfirm(false);
    setScreen("lobby");
  };

  const leaveQueue = () => {
    online.cancelMatchmaking();
    online.returnToLobby();
    setPlayMode("none");
    setLeaveQueueConfirm(false);
    setScreen("lobby");
  };

  const goLobby = () => {
    if (queued) {
      setLeaveQueueConfirm(true);
      return;
    }
    if (inActiveMatch) {
      setExitConfirm(true);
      return;
    }
    leaveToLobby();
  };

  const goHome = () => {
    if (queued) {
      setLeaveQueueConfirm(true);
      return;
    }
    if (inActiveMatch) {
      setExitConfirm(true);
      return;
    }
    leaveToLobby();
  };

  const openLocalModes = () => {
    if (online.state.matchmaking === "queued") {
      online.cancelMatchmaking();
    }
    online.returnToLobby();
    setModeSelectContext("local");
    local.openModeSelect();
    setPlayMode("local");
    setScreen("mode_select");
  };

  const openRankedModes = () => {
    local.returnToLobby();
    setModeSelectContext("ranked");
    setPlayMode("online");
    setScreen("mode_select");
  };

  const startRankedWithMode = (mode: GameMode) => {
    setPlayMode("online");
    online.findMatch(mode);
    setScreen("lobby");
  };

  const goPlay = () => {
    if (viewingMatch) {
      if (playMode === "local") {
        if (local.phase === "selecting_mode") setScreen("mode_select");
        else if (local.phase === "drafting") setScreen("draft");
        else if (local.phase === "choosing_tactic") setScreen("tactics");
        else setScreen("game");
        return;
      }
      if (online.state.phase === "drafting") setScreen("draft");
      else if (online.state.phase === "choosing_tactic") setScreen("tactics");
      else setScreen("game");
      return;
    }
    if (queued) {
      setPlayMode("online");
      setScreen("lobby");
      return;
    }
    openRankedModes();
  };

  if (auth.loading) {
    return (
      <>
        <TopBar
          user={null}
          active="auth"
          onHome={() => undefined}
          onLobby={() => undefined}
          onPlay={() => undefined}
          onLeaderboard={() => undefined}
        />
        <main className="shell">
          <div className="loading-page">Restoring session…</div>
        </main>
      </>
    );
  }

  const localGameMode = local.mode ?? local.game?.mode ?? "classic";
  const localTactics =
    local.game?.tactics && local.yourTactic
      ? { you: local.yourTactic, opponent: local.game.tactics.player2 }
      : null;

  const onlineMode =
    online.state.match?.mode ?? online.state.matchmakingMode ?? "classic";
  const onlineTactics = online.state.match?.tactics ?? null;

  return (
    <>
      <TopBar
        user={auth.user}
        active={topBarActive(screen, queued)}
        onHome={goHome}
        onLobby={goLobby}
        onPlay={goPlay}
        onLeaderboard={() => {
          if (queued || inActiveMatch) return;
          setScreen("leaderboard");
        }}
        onLogout={
          auth.user
            ? async () => {
                online.returnToLobby();
                local.returnToLobby();
                setPlayMode("none");
                await auth.logout();
              }
            : undefined
        }
      />

      <main className="shell">
        {!auth.user && authTab === "login" ? (
          <section className="screen">
            <LoginForm
              onSubmit={auth.login}
              onSwitch={() => {
                setAuthTab("register");
                auth.clearError();
              }}
              error={auth.error}
              busy={auth.loading}
            />
          </section>
        ) : null}

        {!auth.user && authTab === "register" ? (
          <section className="screen">
            <RegisterForm
              onSubmit={auth.register}
              onSwitch={() => {
                setAuthTab("login");
                auth.clearError();
              }}
              error={auth.error}
              busy={auth.loading}
            />
          </section>
        ) : null}

        {auth.user && screen === "lobby" ? (
          <Lobby
            user={auth.user}
            connection={online.state.connection}
            error={online.state.error}
            onFindMatch={openRankedModes}
            onPlayLocal={openLocalModes}
            onLeaderboard={() => setScreen("leaderboard")}
          />
        ) : null}

        {auth.user &&
        screen === "mode_select" &&
        modeSelectContext === "ranked" &&
        playMode === "online" ? (
          <ModeSelect
            context="ranked"
            onSelect={startRankedWithMode}
            onBack={leaveToLobby}
            onHome={goHome}
          />
        ) : null}

        {auth.user &&
        screen === "mode_select" &&
        modeSelectContext === "local" &&
        playMode === "local" ? (
          <ModeSelect
            context="local"
            onSelect={local.selectMode}
            onBack={leaveToLobby}
            onHome={goHome}
          />
        ) : null}

        {auth.user && screen === "leaderboard" ? (
          <Leaderboard
            user={auth.user}
            onBack={() => setScreen("lobby")}
            onHome={goLobby}
          />
        ) : null}

        {auth.user &&
        screen === "draft" &&
        playMode === "local" &&
        local.draft ? (
          <DraftBoard
            draft={local.draft}
            onPick={local.submitDraftPick}
            onHome={goHome}
            onBack={leaveToLobby}
          />
        ) : null}

        {auth.user &&
        screen === "draft" &&
        playMode === "online" &&
        online.state.draft ? (
          <DraftBoard
            draft={online.state.draft}
            yourSeat={online.state.match?.yourSeat ?? "player1"}
            yourPicks={online.state.yourDraftPicks}
            opponentPickCount={online.state.opponentDraftCount}
            onPick={online.submitDraftPick}
            onHome={goHome}
            onBack={leaveToLobby}
          />
        ) : null}

        {auth.user && screen === "tactics" && playMode === "local" ? (
          <TacticSelect
            onConfirm={local.submitTactic}
            onBack={() => {
              local.openModeSelect();
              setModeSelectContext("local");
              setScreen("mode_select");
            }}
            onHome={goHome}
          />
        ) : null}

        {auth.user && screen === "tactics" && playMode === "online" ? (
          <TacticSelect
            locked={online.state.yourTactic}
            opponentReady={online.state.opponentTacticReady}
            onConfirm={online.submitTactic}
            onBack={leaveToLobby}
            onHome={goHome}
          />
        ) : null}

        {auth.user &&
        screen === "game" &&
        playMode === "local" &&
        local.phase === "playing" ? (
          <GameBoard
            state={local.state}
            mode="local"
            gameMode={localGameMode}
            regulationRounds={local.game?.regulationRounds ?? 5}
            suddenDeath={local.game?.suddenDeath ?? false}
            tactics={localTactics}
            onSubmitPick={local.submitPick}
            onHome={goHome}
            onBackToLobby={leaveToLobby}
          />
        ) : null}

        {auth.user &&
        screen === "game" &&
        playMode === "online" &&
        (online.state.phase === "playing" || online.state.endedReason) ? (
          <GameBoard
            state={online.state}
            mode="ranked"
            gameMode={onlineMode}
            regulationRounds={online.state.match?.regulationRounds ?? 5}
            suddenDeath={online.state.match?.suddenDeath ?? false}
            tactics={onlineTactics}
            onSubmitPick={online.submitPick}
            onHome={goHome}
            onBackToLobby={leaveToLobby}
          />
        ) : null}
      </main>

      {auth.user && queueOverlay ? (
        <Matchmaking
          user={auth.user}
          status={online.state.matchmaking}
          mode={online.state.matchmakingMode}
          opponentUsername={online.state.opponentUsername}
          opponentRating={online.state.opponentRating}
          error={online.state.error}
          onCancel={leaveQueue}
          onHome={queued ? goHome : leaveQueue}
          onPlayLocal={openLocalModes}
        />
      ) : null}

      <footer className="shell app-footer">
        <div className="divider" />
        <div className="footer-note">
          <span>SOCCER CARD BATTLE</span>
          <span>Ranked modes · Local practice</span>
        </div>
      </footer>

      {leaveQueueConfirm ? (
        <ConfirmDialog
          title="Leave queue?"
          message="Stop searching for a match and return home?"
          confirmLabel="Leave queue"
          cancelLabel="Keep searching"
          onConfirm={leaveQueue}
          onCancel={() => setLeaveQueueConfirm(false)}
        />
      ) : null}

      {exitConfirm ? (
        <ConfirmDialog
          title="Exit game?"
          message={
            playMode === "local"
              ? "Leave this practice match and return home?"
              : "Leave this match and return home? Leaving may count as a forfeit."
          }
          confirmLabel="Yes"
          cancelLabel="No"
          onConfirm={leaveToLobby}
          onCancel={() => setExitConfirm(false)}
        />
      ) : null}
    </>
  );
}
