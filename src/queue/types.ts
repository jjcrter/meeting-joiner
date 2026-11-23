export const WEBHOOK_QUEUE = "recall-webhook";

export interface WebhookJob {
  webhookId: string;
}

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  work(handler: (job: WebhookJob) => Promise<void>): Promise<void>;
  enqueue(job: WebhookJob): Promise<void>;
  /** Run queued jobs inside this process. Used by tests and the smoke entrypoint. */
  drain(): Promise<void>;
}
