import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Bot } from "../api";

export function LaunchPage() {
  const navigate = useNavigate();
  const [meetingUrl, setMeetingUrl] = useState("");
  const [botName, setBotName] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [joinAtEastern, setJoinAtEastern] = useState("");
  const [transcriptEnabled, setTranscriptEnabled] = useState(true);
  const [chatNoticeEnabled, setChatNoticeEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <section className="grid">
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          api<{ bot: Bot }>("/api/bots", {
            method: "POST",
            body: JSON.stringify({
              meetingUrl,
              botName: botName.trim() || undefined,
              joinAtEastern: when === "later" ? joinAtEastern : undefined,
              transcriptEnabled,
              chatNoticeEnabled,
            }),
          })
            .then((result) => navigate(`/bots/${result.bot.id}`))
            .catch((err: Error) => setError(err.message))
            .finally(() => setPending(false));
        }}
      >
        <h1>Send the notetaker</h1>
        <p className="lede">Paste a Zoom, Google Meet, Teams, or Webex link. The camera tile is the GLDN background, and the transcript is created after the meeting.</p>
        <label htmlFor="meetingUrl">Meeting URL</label>
        <input
          id="meetingUrl"
          required
          placeholder="https://zoom.us/j/…"
          value={meetingUrl}
          onChange={(event) => setMeetingUrl(event.target.value)}
        />
        <label htmlFor="botName">Bot name</label>
        <input id="botName" placeholder="GLDN PR Notetaker" value={botName} onChange={(event) => setBotName(event.target.value)} />
        <div className="row">
          <label className="check">
            <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Join now
          </label>
          <label className="check">
            <input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule
          </label>
        </div>
        {when === "later" ? (
          <>
            <label htmlFor="joinAt">Eastern Time</label>
            <input
              id="joinAt"
              type="datetime-local"
              required
              value={joinAtEastern}
              onChange={(event) => setJoinAtEastern(event.target.value)}
            />
            <p className="muted">Shown and stored as America/New_York, sent to Recall in UTC.</p>
          </>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={transcriptEnabled} onChange={(event) => setTranscriptEnabled(event.target.checked)} />
          Create a transcript after the meeting
        </label>
        <label className="check">
          <input type="checkbox" checked={chatNoticeEnabled} onChange={(event) => setChatNoticeEnabled(event.target.checked)} />
          Post a one-time recording notice in chat
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="actions">
          <button className="primary" disabled={pending} type="submit">
            {pending ? "Launching…" : "Launch bot"}
          </button>
        </div>
      </form>
      <aside className="card">
        <h2>Camera tile</h2>
        <p className="muted">This 1280×720 image is what the meeting sees instead of a black tile.</p>
        <img className="tile-preview" src="/brand/bot-background.jpg" alt="GLDN PR branded bot camera tile" />
      </aside>
    </section>
  );
}
