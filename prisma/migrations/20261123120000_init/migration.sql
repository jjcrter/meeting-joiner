-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "recall_bot_id" TEXT,
    "meeting_url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "bot_name" TEXT NOT NULL,
    "join_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "launched_by_user_id" TEXT,
    "calendar_event_id" TEXT,
    "latest_status" TEXT NOT NULL DEFAULT 'scheduled',
    "latest_sub_code" TEXT,
    "latest_status_at" TIMESTAMP(3),
    "transcript_enabled" BOOLEAN NOT NULL DEFAULT true,
    "chat_notice_enabled" BOOLEAN NOT NULL DEFAULT false,
    "create_state" TEXT NOT NULL DEFAULT 'pending',
    "create_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_status_events" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sub_code" TEXT,
    "recall_updated_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" TEXT NOT NULL,
    "recall_recording_id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sub_code" TEXT,
    "transcript_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "recall_transcript_id" TEXT,
    "recording_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sub_code" TEXT,
    "provider" TEXT,
    "raw_json" JSONB,
    "readable_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendars" (
    "id" TEXT NOT NULL,
    "recall_calendar_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platform_email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "recall_event_id" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "ical_uid" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "meeting_url" TEXT,
    "meeting_platform" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "should_record" BOOLEAN NOT NULL DEFAULT false,
    "recall_bot_ids" JSONB NOT NULL DEFAULT '[]',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "schedule_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("recall_event_id")
);

-- CreateTable
CREATE TABLE "recording_prefs" (
    "user_id" TEXT NOT NULL,
    "rule" TEXT NOT NULL DEFAULT 'manual',
    "overrides" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "recording_prefs_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "webhook_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("webhook_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "bots_recall_bot_id_key" ON "bots"("recall_bot_id");
CREATE INDEX "bots_updated_at_idx" ON "bots"("updated_at");
CREATE INDEX "bots_launched_by_user_id_idx" ON "bots"("launched_by_user_id");
CREATE UNIQUE INDEX "bot_status_events_bot_id_code_sub_code_recall_updated_at_key" ON "bot_status_events"("bot_id", "code", "sub_code", "recall_updated_at") NULLS NOT DISTINCT;
CREATE INDEX "bot_status_events_bot_id_recall_updated_at_idx" ON "bot_status_events"("bot_id", "recall_updated_at");
CREATE UNIQUE INDEX "recordings_recall_recording_id_key" ON "recordings"("recall_recording_id");
CREATE INDEX "recordings_bot_id_idx" ON "recordings"("bot_id");
CREATE UNIQUE INDEX "transcripts_recall_transcript_id_key" ON "transcripts"("recall_transcript_id");
CREATE INDEX "transcripts_recording_id_idx" ON "transcripts"("recording_id");
CREATE UNIQUE INDEX "calendars_recall_calendar_id_key" ON "calendars"("recall_calendar_id");
CREATE INDEX "calendars_user_id_idx" ON "calendars"("user_id");
CREATE INDEX "calendar_events_calendar_id_start_time_idx" ON "calendar_events"("calendar_id", "start_time");
CREATE INDEX "calendar_events_ical_uid_idx" ON "calendar_events"("ical_uid");
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_launched_by_user_id_fkey" FOREIGN KEY ("launched_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bot_status_events" ADD CONSTRAINT "bot_status_events_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recording_prefs" ADD CONSTRAINT "recording_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
