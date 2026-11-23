import { useEffect, useState } from "react";
import { api, formatEastern, platformLabel, type CalendarConnection, type CalendarEvent } from "../api";

interface CalendarPayload {
  calendar: CalendarConnection | null;
  prefs: { rule: "manual" | "auto_all" | "external_only" };
  events: CalendarEvent[];
  googleConfigured: boolean;
}

export function CalendarPage() {
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<CalendarPayload>("/api/calendar")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  if (!data) return <p>{error ?? "Loading…"}</p>;
  const connected = data.calendar && data.calendar.status !== "disconnected";

  return (
    <section>
      <div className="card">
        <h1>Calendar</h1>
        <p className="lede">
          Connecting Google Calendar syncs the primary calendar. It does not send a bot until you turn Record on, or choose an auto rule. Bots for the same meeting share one deduplication key.
        </p>
        {!data.googleConfigured ? <p className="error">Google OAuth is not configured yet. See the README.</p> : null}
        {connected ? (
          <>
            <p>
              <span className={data.calendar?.status === "connected" ? "badge" : "badge warn"}>{data.calendar?.status}</span>{" "}
              {data.calendar?.platformEmail}
            </p>
            {data.calendar?.status === "disconnected" ? (
              <p className="error">This calendar needs to be reconnected. Google testing apps expire refresh tokens after 7 days.</p>
            ) : null}
            <label htmlFor="rule">Auto-record rule</label>
            <select
              id="rule"
              value={data.prefs.rule}
              onChange={(event) => {
                void api("/api/calendar/prefs", {
                  method: "PUT",
                  body: JSON.stringify({ rule: event.target.value }),
                }).then(load);
              }}
            >
              <option value="manual">Manual — only meetings I mark</option>
              <option value="external_only">External — meetings with someone outside our domain</option>
              <option value="auto_all">All future meetings that have a link</option>
            </select>
            <div className="actions">
              <a className="primary" href="/api/calendar/oauth/google">
                Reconnect Google Calendar
              </a>
              <button
                className="ghost"
                onClick={() => {
                  void api("/api/calendar/sync", { method: "POST" }).then(load).catch((err: Error) => setError(err.message));
                }}
              >
                Sync now
              </button>
              <button
                className="danger"
                onClick={() => {
                  void api("/api/calendar", { method: "DELETE" }).then(load).catch((err: Error) => setError(err.message));
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <a className="primary" href="/api/calendar/oauth/google">
            Connect Google Calendar
          </a>
        )}
        {error ? <p className="error">{error}</p> : null}
      </div>
      {connected ? (
        <div className="card" style={{ marginTop: 20 }}>
          <h2>Next 28 days</h2>
          <table>
            <thead>
              <tr>
                <th>When (ET)</th>
                <th>Meeting</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.recallEventId}>
                  <td>{formatEastern(event.startTime)}</td>
                  <td>
                    {event.title}
                    <div className="muted">
                      {event.meetingPlatform ? platformLabel(event.meetingPlatform) : "No link"}
                      {event.scheduleError ? ` · ${event.scheduleError}` : ""}
                      {event.recallBotIds.length ? " · bot scheduled" : ""}
                    </div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={event.shouldRecord}
                      aria-label={`Record ${event.title}`}
                      onChange={(change) => {
                        void api(`/api/calendar/events/${event.recallEventId}/recording`, {
                          method: "POST",
                          body: JSON.stringify({ record: change.target.checked }),
                        }).then(load);
                      }}
                    />
                  </td>
                </tr>
              ))}
              {data.events.length === 0 ? (
                <tr>
                  <td colSpan={3}>No upcoming meetings in the sync window.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
