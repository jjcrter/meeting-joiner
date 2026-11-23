import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type User } from "./api";
import { BotDetailPage } from "./pages/BotDetail";
import { BotsPage } from "./pages/Bots";
import { CalendarPage } from "./pages/Calendar";
import { LaunchPage } from "./pages/Launch";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<{ user: User | null }>("/api/auth/session")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <main className="shell">Loading…</main>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onUser={setUser} />} />
      <Route
        path="*"
        element={
          user ? (
            <Shell user={user} onLogout={() => setUser(null)}>
              <Routes>
                <Route path="/" element={<LaunchPage />} />
                <Route path="/bots" element={<BotsPage />} />
                <Route path="/bots/:id" element={<BotDetailPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}

function Shell({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <main className="shell">
      <header className="top">
        <a className="brand" href="/">
          <span className="mark" aria-hidden="true" />
          <span>
            <strong>GLDN PR</strong>
            <span>STRATEGIC VISIBILITY</span>
          </span>
        </a>
        <nav>
          <NavLink to="/" end>
            Launch
          </NavLink>
          <NavLink to="/bots">Bots</NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          <button
            className="ghost"
            onClick={() => {
              void api("/api/auth/logout", { method: "POST" }).finally(() => {
                onLogout();
                navigate("/login");
              });
            }}
          >
            Sign out
          </button>
        </nav>
      </header>
      <p className="muted">{user.email}</p>
      {children}
    </main>
  );
}
