import { useEffect, useState } from "react";
import { api, formatEastern } from "../api";

interface Health {
  region: string;
  apiBaseUrl: string;
  webhookUrl: string;
  env: Record<string, boolean>;
  googleOAuth: boolean;
  lastWebhookReceivedAt: string | null;
}

export function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Health>("/api/health")
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (!health) return <p>{error ?? "Loading…"}</p>;
  return (
    <section className="card">
      <h1>Settings</h1>
      <p>
        Region <strong>{health.region}</strong>
      </p>
      <p className="muted">{health.apiBaseUrl}</p>
      <h2>Webhook endpoint</h2>
      <p>{health.webhookUrl}</p>
      <p className="muted">
        Last webhook: {health.lastWebhookReceivedAt ? formatEastern(health.lastWebhookReceivedAt) : "none yet"}
      </p>
      <h2>Environment</h2>
      <ul>
        {Object.entries(health.env).map(([name, present]) => (
          <li key={name}>
            {name}: {present ? "set" : "not set"}
          </li>
        ))}
      </ul>
      <p className="muted">Values are never shown. Google OAuth {health.googleOAuth ? "is" : "is not"} ready for calendar connect.</p>
    </section>
  );
}
