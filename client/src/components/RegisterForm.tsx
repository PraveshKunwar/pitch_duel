import { useState, type FormEvent } from "react";

type Props = {
  onSubmit: (
    email: string,
    username: string,
    password: string,
  ) => Promise<unknown>;
  onSwitch: () => void;
  error: string | null;
  busy: boolean;
};

export function RegisterForm({ onSubmit, onSwitch, error, busy }: Props) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSubmit(email.trim(), username.trim(), password);
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
          <h2>Join the competition</h2>
          <p>Your next rivalry starts here.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="field">
            Username
            <input
              name="username"
              autoComplete="username"
              placeholder="Choose your player name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={30}
              pattern="^[a-zA-Z0-9_-]+$"
              required
            />
          </label>
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
              autoComplete="new-password"
              placeholder="At least 12 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        {busy ? <div className="notice">Creating your account…</div> : null}
        <p className="form-foot">
          Already playing?{" "}
          <button type="button" onClick={onSwitch}>
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
