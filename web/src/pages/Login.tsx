import { useState } from "react";
import { api, type User } from "../api";

export function LoginPage({ onUser }: { onUser: (user: User) => void }) {
  const [email, setEmail] = useState("jj@gldnpr.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="shell">
      <form
        className="card login"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          api<{ user: User }>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          })
            .then((result) => onUser(result.user))
            .catch((err: Error) => setError(err.message));
        }}
      >
        <h1>Notetaker</h1>
        <p className="lede">GLDN PR meeting notes. The bot joins silently unless you turn the chat notice on for that meeting.</p>
        <a className="primary" href="/api/auth/google">
          Sign in with Google
        </a>
        <label htmlFor="email">Work email</label>
        <input id="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
        <label htmlFor="password">Shared password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        {error ? <p className="error">{error}</p> : <p className="muted">Google sign-in is limited to @gldnpr.com. The password form is only available when APP_SHARED_PASSWORD is set.</p>}
        <div className="actions">
          <button className="primary" type="submit">
            Sign in
          </button>
        </div>
      </form>
    </main>
  );
}
