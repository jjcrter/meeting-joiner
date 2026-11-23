# GLDN PR meeting notetaker

Internal tool for GLDN PR. A teammate pastes a Zoom, Google Meet, Microsoft Teams, or Webex URL and launches a Recall.ai bot, then watches its status and reads the transcript after the meeting. Teammates can also connect Google Calendar. Upcoming meetings are listed, and bots are scheduled only when someone opts in (or turns on an auto rule), with one shared bot per meeting.

Recall workspace: **GLDN PR** (`f1cd60ac-7e43-46ee-8efc-24aae918e089`). Region: **us-west-2** (US West, Oregon) only. API base: `https://us-west-2.recall.ai`. Bot schema: v1.11 (`recording_config` is not sent at create time; transcripts are created after `recording.done`).

The bot is a silent notetaker. It does not post in meeting chat unless the person launching that meeting turns the notice on. Calendar connect does not, by itself, send a bot to every meeting.

## Product choices

- **Meeting bots**, not the Desktop SDK. The bot joins as a visible participant named `GLDN PR Notetaker`.
- **Post-meeting Recall.ai transcription** (`recallai_async`, language `auto`, separate-stream diarization). Live transcript is not enabled. Recall bills this transcription; no second transcription vendor is required.
- **Camera tile.** Every bot sends `automatic_video_output` for both `in_call_not_recording` and `in_call_recording`, using `assets/bot-background.jpg` (1280×720 JPEG, standard base64). The whole Zoom/Meet/Teams/Webex tile is that image.
- **Calendar V2, Google only.** Deduplication key is `{start_time}-{meeting_url}` (Deduplicate All). Do not change that format; existing scheduled bots depend on it. The default recording rule is **manual**.
- **Sign-in** is Google, restricted to `@gldnpr.com`, with an optional shared password for the time before Google verification is done.

## File map

| Path | What it does |
|---|---|
| `src/index.ts` | Loads env, prints `RECALL_REGION`, starts Postgres, pg-boss, and the HTTP server. `--smoke` runs the in-process demo. |
| `src/config/env.ts` | Startup validation. Fails with the missing variable name and the README section that sets it. |
| `src/recall/client.ts` | Recall API client. Every call uses `fetchWithRetry` and `https://us-west-2.recall.ai`. |
| `src/recall/fetchWithRetry.ts` | 429 / 503 / 507 retries, plus 409 backoff for calendar schedule and unschedule. |
| `src/webhooks/verify.ts` | Workspace-secret HMAC check, 5-minute timestamp window, multi-signature rotation warning. |
| `src/http/app.ts` | Launch, bots, calendar, Google OAuth, health, and `POST /api/recall/webhook`. |
| `src/jobs/processWebhook.ts` | Turns verified webhooks into bot status, transcripts, and calendar sync. |
| `src/services/calendar.ts` | Opt-in rules, deduped schedule/unschedule, disconnect. |
| `src/db/prismaRepository.ts` | Postgres via Prisma. |
| `src/queue/pgBossQueue.ts` | pg-boss queue so the webhook HTTP handler returns before work runs. |
| `web/` | React UI (Launch, Bots, Calendar, Settings). |
| `assets/bot-background.jpg` | Branded 1280×720 camera image. |
| `prisma/` | Schema and the initial migration. |

## Local setup

Requirements: Node.js 22, Docker (for Postgres 16), and a static public HTTPS URL before any live Recall call.

```bash
docker compose up -d db
cp .env.example .env
# fill .env using the sections below, then:
npx prisma migrate deploy
npm run dev
```

`npm run dev` serves the API on port 3000 and the UI on port 5173. The UI proxies `/api` to the API. Production (`npm start` or Docker) serves the built UI and the API from the same process.

On startup the API prints:

```text
RECALL_REGION=us-west-2
Webhook endpoint https://<your-host>/api/recall/webhook
```

It exits if `RECALL_REGION` is anything other than `us-west-2`.

### Database

`docker compose up -d db` starts Postgres 16. The local URL is:

```text
postgresql://gldn:gldn@localhost:5432/gldn_recall
```

That password is only for the local Docker database. Apply migrations with `npx prisma migrate deploy`.

### App session

Set `SESSION_SECRET` to a long random string (at least 16 characters). It signs the login cookie. It is not a Recall secret.

Optional: set `APP_SHARED_PASSWORD`. Then a `@gldnpr.com` email plus that password can sign in. Leave it empty once Google sign-in is the path you want.

### Public URL

`PUBLIC_API_BASE_URL` is the https origin Recall calls. No trailing slash, no localhost, no IP address.

For local development, claim a static domain at [dashboard.ngrok.com](https://dashboard.ngrok.com) → Domains, then:

```bash
ngrok http --domain <your-static-domain> 3000
```

Set `PUBLIC_API_BASE_URL=https://<your-static-domain>`. Do not let this change between restarts. If the UI is served from the same origin, leave `APP_BASE_URL` unset.

## Region

Open [https://us-west-2.recall.ai/dashboard/](https://us-west-2.recall.ai/dashboard/) and confirm the workspace is **GLDN PR**. This account has no other region. Do not create keys or webhooks on `api.recall.ai` or any other regional host.

## API key

1. Sign in to the us-west-2 dashboard as the service owner (a shared engineering mailbox is better than a personal login, because keys belong to the user who created them).
2. Open [API keys](https://us-west-2.recall.ai/dashboard/developers/api-keys).
3. Create a REST API key for this app.
4. Store it as `RECALL_API_KEY` in the host secret manager or local `.env`. Paste the key only. Do not prefix it with `Token `.

There were no REST API keys in the workspace when this app was built. Do not commit the key.

## Workspace verification secret

1. On the same [API keys page](https://us-west-2.recall.ai/dashboard/developers/api-keys), choose **Create Workspace Secret**.
2. Store the value (it starts with `whsec_`) as `RECALL_WEBHOOK_VERIFICATION_SECRET`.
3. This workspace signs dashboard webhooks with that workspace secret and `webhook-*` headers. Do not copy a per-endpoint Svix signing secret, and do not set `RECALL_SVIX_WEBHOOK_SECRET`.

`RECALL_WEBHOOK_SECRET` and `RECALL_WORKSPACE_VERIFICATION_SECRET` are accepted aliases if a host already used one of those names.

## Register the webhook

After the app is reachable at `PUBLIC_API_BASE_URL`:

1. Open [webhooks](https://us-west-2.recall.ai/dashboard/webhooks/).
2. Create an endpoint:
   - URL: `PUBLIC_API_BASE_URL/api/recall/webhook` (for example `https://notetaker.gldnpr.com/api/recall/webhook`)
   - Subscribe to every event below. If the dashboard offers `bot.*`, use it and still add the recording, transcript, and calendar events.
3. Send a test event. The app must answer 2xx. Settings shows the last webhook time. Deliveries are also listed in the dashboard.

Events:

- `bot.joining_call`
- `bot.in_waiting_room`
- `bot.in_call_not_recording`
- `bot.recording_permission_allowed`
- `bot.recording_permission_denied`
- `bot.in_call_recording`
- `bot.call_ended`
- `bot.done`
- `bot.fatal`
- `bot.breakout_room_entered`
- `bot.breakout_room_left`
- `bot.breakout_room_opened`
- `bot.breakout_room_closed`
- `recording.done`
- `recording.failed`
- `transcript.done`
- `transcript.failed`
- `calendar.update`
- `calendar.sync_events`

The handler reads the raw body, verifies the workspace secret, stores the event by `webhook-id`, enqueues it on pg-boss, and returns 200 before the transcript or calendar work runs. A bad signature returns 400 and is not stored. Duplicate deliveries of the same `webhook-id` are ignored. More than one `v1` signature is logged as a secret rotation (the previous secret stays valid for about 24 hours).

## Google OAuth

Use a Google Cloud project GLDN owns. Leave the client non-agentic. Calendar V2 uses the Calendar REST API.

1. Enable the **Google Calendar API**. A Manage button means it is already on.
2. Configure the OAuth consent screen.
   - App name: something a teammate will recognize, such as `GLDN PR Notetaker`.
   - If every account is in the GLDN Google Workspace, choose **Internal**. That avoids Google's verification review.
   - Otherwise choose External, leave it in Testing, and add each teammate under Test users. Testing refresh tokens expire after 7 days. Publishing to production is required before this is durable, and the sensitive `calendar.events.readonly` scope needs Google's verification (scope justification plus a demo video).
3. Data access scopes, and no broader calendar write scope:
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `openid` and `https://www.googleapis.com/auth/userinfo.profile` if you also use Google sign-in
4. Create a dedicated **Web application** OAuth client. Do not reuse a desktop or sign-in-only client.
5. Authorized redirect URIs (not JavaScript origins):
   - `https://<public host>/api/calendar/oauth/google/callback`
   - `https://<public host>/api/auth/google/callback` (Google sign-in)
6. Put the client id and secret in `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Set `GOOGLE_OAUTH_REDIRECT_URI` to the calendar callback. The domain must be GLDN's, not Recall's.

Suggested scope justification: "We need calendar.events.readonly to find video meetings on a teammate's primary calendar and let them choose which meetings the GLDN notetaker joins."

Outlook is not wired up. Add it later with the Microsoft Calendar V2 guide if it is needed.

## Deployment

The Docker image runs `prisma migrate deploy` and then the server.

```bash
docker compose up --build
```

Set the same environment variables in the host secret store. `DATABASE_URL` inside Compose points at the `db` service. For a hosted deploy, use managed Postgres 16 (or newer) and set `PUBLIC_API_BASE_URL` to that service's https origin.

Do not put the API key, verification secret, Google secret, or refresh tokens in the image, the repo, or logs.

## Automated checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run smoke
```

Tests use a fake Recall server. They cover env validation, webhook signatures (valid, tampered, wrong secret, multiple signatures, missing headers, stale timestamp), retry timing, the dedup key, recording rules, the launch payload (video, `join_at`, no chat, us-west-2), the webhook-to-transcript path, and calendar scheduling. `npm run smoke` builds the real Fastify app, logs in, launches a bot against the fake Recall server, rejects a bad signature, applies a status webhook, and requests `/healthz` on 127.0.0.1.

## Branded camera tile

`assets/bot-background.jpg` is a 1280×720 JPEG (under Recall's 1.3 MB limit). At startup the server base64-encodes it with the standard alphabet and places the same string on:

```json
"automatic_video_output": {
  "in_call_not_recording": { "kind": "jpeg", "b64_data": "<file>" },
  "in_call_recording": { "kind": "jpeg", "b64_data": "<file>" }
}
```

That object is included on manual Create Bot calls and on every calendar `bot_config`. Recall shows it as the bot's camera on Zoom, Google Meet, Microsoft Teams, and Webex. The Launch page previews the same file at `/brand/bot-background.jpg`.

Replace the file only with another 1280×720 JPEG. The process refuses to start otherwise. Keep the logo and the words in the center; Meet crops the edges of a participant tile.

## How to test a live bot

Do this only after the API key, verification secret, public URL, and webhook endpoint are in place. Use a meeting you control.

1. Start the app. Confirm the log line `RECALL_REGION=us-west-2` and open Settings. Region is us-west-2, the required env rows say set, and the webhook URL matches the dashboard endpoint.
2. Send the dashboard test webhook. Settings should show a last-webhook time, and the delivery in the dashboard should be 2xx.
3. Start a Zoom meeting (a personal room is enough). On Launch, paste the URL, leave the chat notice off, and choose Launch bot.
4. Admit the notetaker from the waiting room. The bot detail page should say the host must admit it while it is waiting, then move through joining, in-call, and recording as webhooks arrive. The camera tile should be the navy GLDN image with the mark and "STRATEGIC VISIBILITY", not a black tile.
5. Talk for about a minute and end the meeting. After `recording.done` the app calls Create Async Transcript. When `transcript.done` arrives, the transcript is on the bot page and can be downloaded as text or JSON.
6. Repeat with a Google Meet link.
7. Schedule a manual bot a few minutes ahead (the time picker is Eastern Time) and cancel it from the bot page before it joins.
8. In the Recall dashboard, open the bot (the detail page links to `https://us-west-2.recall.ai/dashboard/explorer/bot/<id>` and shows the id) and confirm the logs match the timeline.

## How to test calendar scheduling

1. Connect Google Calendar from the Calendar page with a `@gldnpr.com` account. The first sync fills the next 28 days. Nothing is recorded yet, because the rule is Manual.
2. Create a Google event about 15 minutes out with a Zoom link. Click Sync now if it is not listed yet.
3. Turn Record on for that event. Recall schedules one bot. The dedup key is the event start time, a hyphen, and the meeting URL.
4. Move the event. The next `calendar.sync_events` webhook reschedules by calling Schedule Bot again with the same key style. Recall replaces the previous bot.
5. Delete the event. Recall unschedules the bot. The app does not send a separate unschedule for deleted events.
6. Turn the auto rule to "External" or "All future meetings" only if that is what you want. External means at least one attendee whose email domain is not the connected calendar's domain. A series toggle is stored by `ical_uid` and overrides the rule.
7. Disconnect. That calls Delete Calendar and Recall removes future bots for that calendar immediately.

Google Calendar in Testing mode drops the refresh token after 7 days. The Calendar page shows a disconnected status when Recall reports it; use Reconnect. Make bot config changes at least 10 minutes before the start. The app does not `PATCH /api/v1/bot/` for calendar bots.

## Recording rules

| Rule | What gets a bot |
|---|---|
| Manual (default) | Only series you mark Record |
| External | Future events with a meeting link and an attendee outside your calendar domain, unless you opt that series out |
| All future meetings | Every future event with a meeting link, unless you opt that series out |

Deleted events, events that already started, and events with no meeting URL are never scheduled. Calendar bots join two minutes early when that time is still in the future.

## What is left for JJ

The app builds and the automated tests pass. These steps need a person and real credentials. None of them were done in this change, because the download links for a new key expire in minutes and this repo is public.

1. Confirm the us-west-2 / GLDN PR workspace in the dashboard.
2. Choose the public host (`PUBLIC_API_BASE_URL`) or a static ngrok domain.
3. Create the REST API key and the workspace verification secret in us-west-2, and put them in the host secret store. Do not paste them into chat or git.
4. Provision Postgres, set `DATABASE_URL` and `SESSION_SECRET`, and run `npx prisma migrate deploy`.
5. Deploy or run the app and register the webhook URL with the event list above. Send the dashboard test event and confirm 2xx.
6. Create the Google OAuth client and redirect URIs. Connect a `@gldnpr.com` calendar.
7. Run the live Zoom tile test and the calendar schedule / reschedule / disconnect test above.

No bot has been sent to a real meeting from this repository yet.
