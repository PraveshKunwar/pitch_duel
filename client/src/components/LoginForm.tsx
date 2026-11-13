import { useState, type FormEvent } from "react";

type Props = {
  onSubmit: (email: string, password: string) => Promise<unknown>;
  onSwitch: () => void;
  error: string | null;
  busy: boolean;
};

export function LoginForm({ onSubmit, onSwitch, error, busy }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSubmit(email.trim(), password);
  }

  return (
    <div className="auth">
      <div className="intro">
        <span className="eyebrow">Five cards. Five rounds. One winner.</span>
        <h1>
          Your hand.
          <br />
          Your game.
        </h1>
        <p>
          Read the matchup. Make your pick. Turn a great squad into a winning
          strategy.
        </p>
      </div>
      <div className="panel">
        <div className="form-title">
          <span className="eyebrow">Soccer Card Battle</span>
          <h2>Welcome back</h2>
          <p>The pitch is waiting for you.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="field">
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        {busy ? <div className="notice">Signing you in…</div> : null}
        <p className="form-foot">
          New to the game?{" "}
          <button type="button" onClick={onSwitch}>
            Create an account
          </button>
        </p>
      </div>
    </div>
  );
}
