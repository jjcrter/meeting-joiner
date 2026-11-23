import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, formatEastern, platformLabel, type Bot, type StatusEvent, type Transcript } from "../api";

interface Detail {
  bot: Bot;
  statusEvents: StatusEvent[];
  transcripts: Transcript[];
  dashboardUrl: string;
}

export function BotDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    api<Detail>(`/api/bots/${id}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
    const source = new EventSource("/api/events/stream");
    source.onmessage = () => load();
    return () => source.close();
  }, [id]);

  if (!detail) return <p>{error ?? "Loading…"}</p>;
  const { bot } = detail;
  const transcript = [...detail.transcripts].reverse().find((item) => item.readableText) ?? detail.transcripts.at(-1);
  const inCall = ["in_waiting_room", "in_call_not_recording", "in_call_recording", "recording_permission_allowed"].includes(
    bot.latestStatus,
  );

  return (
    <section className="grid">
      <div className="card">
        <h1>{bot.botName}</h1>
        <p>
          <span className={bot.latestStatus === "fatal" ? "badge bad" : "badge"}>{bot.latestStatus}</span>
        </p>
        {bot.latestStatus === "in_waiting_room" ? <p className="ok">The host must admit the notetaker before it can record.</p> : null}
        {bot.latestStatus === "fatal" ? (
          <p className="error">
            Fatal{bot.latestSubCode ? `: ${bot.latestSubCode}` : ""}. Open the bot in the Recall dashboard for the log.
          </p>
        ) : null}
        {bot.createError ? <p className="error">{bot.createError}</p> : null}
        <p className="muted">
          {platformLabel(bot.platform)} · {bot.source} · {formatEastern(bot.joinAt)}
        </p>
        <p>
          <a href={bot.meetingUrl}>{bot.meetingUrl}</a>
        </p>
        <p>
          <a href={detail.dashboardUrl}>Open in the us-west-2 Recall dashboard</a>
          {bot.recallBotId ? <span className="muted"> · {bot.recallBotId}</span> : null}
        </p>
        <div className="actions">
          {bot.latestStatus === "scheduled" && bot.recallBotId ? (
            <button
              className="danger"
              onClick={() => {
                void api(`/api/bots/${bot.id}/cancel`, { method: "POST" }).then(load);
              }}
            >
              Cancel
            </button>
          ) : null}
          {inCall ? (
            <button
              className="danger"
              onClick={() => {
                void api(`/api/bots/${bot.id}/leave`, { method: "POST" }).then(load);
              }}
            >
              Remove from call
            </button>
          ) : null}
        </div>
        <h2>Status</h2>
        <ol>
          {detail.statusEvents.map((event) => (
            <li key={event.id}>
              {event.code}
              {event.subCode ? ` (${event.subCode})` : ""} · {formatEastern(event.recallUpdatedAt)}
            </li>
          ))}
          {detail.statusEvents.length === 0 ? <li>Waiting for the first webhook.</li> : null}
        </ol>
      </div>
      <div className="card">
        <h2>Transcript</h2>
        {transcript?.status === "failed" ? <p className="error">Transcript failed{transcript.subCode ? `: ${transcript.subCode}` : ""}.</p> : null}
        {transcript?.readableText ? (
          <>
            <pre className="transcript">{transcript.readableText}</pre>
            <div className="actions">
              <a className="ghost" href={`/api/bots/${bot.id}/transcript.txt`}>
                Download text
              </a>
              <a className="ghost" href={`/api/bots/${bot.id}/transcript.json`}>
                Download JSON
              </a>
            </div>
          </>
        ) : (
          <p className="muted">
            {bot.transcriptEnabled
              ? "The transcript is created after the recording is ready. Recall.ai Transcription runs post-meeting and is billed by Recall."
              : "Transcripts were turned off for this launch."}
          </p>
        )}
      </div>
    </section>
  );
}
