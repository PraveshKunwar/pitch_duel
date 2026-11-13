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
import type { AppScreen } from "./types/game";

function topBarActive(
  screen: AppScreen,
): "lobby" | "game" | "leaderboard" | "auth" | "matchmaking" {
  if (screen === "auth") return "auth";
  if (screen === "leaderboard") return "leaderboard";
  if (screen === "matchmaking") return "matchmaking";
  if (
    screen === "game" ||
    screen === "mode_select" ||
    screen === "draft" ||
    screen === "tactics"
  ) {
    return "game";
  }
  return "lobby";
}

export default function App() {
  const auth = useAuth();
  const [screen, setScreen] = useState<AppScreen>("auth");
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [playMode, setPlayMode] = useState<"none" | "online" | "local">("none");
  const [exitConfirm, setExitConfirm] = useState(false);
  const online = useGameSocket(Boolean(auth.user));
  const local = useLocalGame(auth.user);

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
  const inActiveMatch = inOnlineMatch || inLocalMatch || inLocalSetup;
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
      if (mm === "queued" || mm === "found") {
        setScreen("matchmaking");
        return;
      }
      if (online.state.gameId && online.state.endedReason === null) {
        setScreen("game");
        return;
      }
      if (online.state.gameId && online.state.endedReason) {
        setScreen("game");
        return;
      }
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
    screen,
  ]);

  useEffect(() => {
    if (online.state.endedReason && playMode === "online") {
      void auth.refreshUser().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online.state.endedReason, playMode]);

  const leaveToLobby = () => {
    if (online.state.matchmaking === "queued") {
      online.cancelMatchmaking();
    }
    online.returnToLobby();
    local.returnToLobby();
    setPlayMode("none");
    setExitConfirm(false);
    setScreen("lobby");
  };

  const goLobby = () => {
    if (inActiveMatch) {
      setExitConfirm(true);
      return;
    }
    leaveToLobby();
  };

  const goHome = () => {
    if (inActiveMatch) {
      setExitConfirm(true);
      return;
    }
    leaveToLobby();
  };

  const startLocal = () => {
    if (online.state.matchmaking === "queued") {
      online.cancelMatchmaking();
    }
    online.returnToLobby();
    local.openModeSelect();
    setPlayMode("local");
    setScreen("mode_select");
  };

  const startOnline = () => {
    local.returnToLobby();
    setPlayMode("online");
    online.findMatch();
    setScreen("matchmaking");
  };

  const goPlay = () => {
    if (viewingMatch) {
      if (local.phase === "selecting_mode") setScreen("mode_select");
      else if (local.phase === "drafting") setScreen("draft");
      else if (local.phase === "choosing_tactic") setScreen("tactics");
      else setScreen("game");
      return;
    }
    if (
      online.state.matchmaking === "queued" ||
      online.state.matchmaking === "found"
    ) {
      setPlayMode("online");
      setScreen("matchmaking");
      return;
    }
    startOnline();
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

  return (
    <>
      <TopBar
        user={auth.user}
        active={topBarActive(screen)}
        onHome={goHome}
        onLobby={goLobby}
        onPlay={goPlay}
        onLeaderboard={() => {
          if (inActiveMatch) return;
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
            onFindMatch={startOnline}
            onPlayLocal={startLocal}
            onLeaderboard={() => setScreen("leaderboard")}
          />
        ) : null}

        {auth.user && screen === "matchmaking" ? (
          <Matchmaking
            user={auth.user}
            status={online.state.matchmaking}
            opponentUsername={online.state.opponentUsername}
            opponentRating={online.state.opponentRating}
            error={online.state.error}
            onCancel={() => {
              online.cancelMatchmaking();
              setPlayMode("none");
              setScreen("lobby");
            }}
            onHome={goLobby}
            onPlayLocal={startLocal}
          />
        ) : null}

        {auth.user && screen === "leaderboard" ? (
          <Leaderboard
            user={auth.user}
            onBack={() => setScreen("lobby")}
            onHome={goLobby}
          />
        ) : null}

        {auth.user && screen === "mode_select" && playMode === "local" ? (
          <ModeSelect
            onSelect={local.selectMode}
            onBack={leaveToLobby}
            onHome={goHome}
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

        {auth.user && screen === "tactics" && playMode === "local" ? (
          <TacticSelect
            onConfirm={local.submitTactic}
            onBack={() => {
              local.openModeSelect();
              setScreen("mode_select");
            }}
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

        {auth.user && screen === "game" && playMode === "online" ? (
          <GameBoard
            state={online.state}
            mode="ranked"
            onSubmitPick={online.submitPick}
            onHome={goHome}
            onBackToLobby={() => {
              leaveToLobby();
              void auth.refreshUser();
            }}
          />
        ) : null}
      </main>

      <footer className="shell app-footer">
        <div className="divider" />
        <div className="footer-note">
          <span>SOCCER CARD BATTLE</span>
          <span>Ranked 1v1 · Local modes</span>
        </div>
      </footer>

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
