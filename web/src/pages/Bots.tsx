import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatEastern, platformLabel, type Bot } from "../api";

export function BotsPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<{ bots: Bot[] }>("/api/bots")
      .then((result) => setBots(result.bots))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
    const source = new EventSource("/api/events/stream");
    source.onmessage = () => load();
    return () => source.close();
  }, []);

  return (
    <section className="card">
      <h1>Bots</h1>
      <p className="lede">Status comes from Recall webhooks. This page listens to our database, not to Recall.</p>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meeting</th>
            <th>When (ET)</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {bots.map((bot) => (
            <tr key={bot.id}>
              <td>
                <span className={bot.latestStatus === "fatal" ? "badge bad" : "badge"}>{bot.latestStatus}</span>
              </td>
              <td>
                <Link to={`/bots/${bot.id}`}>{bot.botName}</Link>
                <div className="muted">{platformLabel(bot.platform)}</div>
              </td>
              <td>{formatEastern(bot.joinAt)}</td>
              <td>{bot.source}</td>
            </tr>
          ))}
          {bots.length === 0 ? (
            <tr>
              <td colSpan={4}>No bots yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
