import PgBoss from "pg-boss";
import type { JobQueue, WebhookJob } from "./types";
import { WEBHOOK_QUEUE } from "./types";

export class PgBossQueue implements JobQueue {
  private boss: PgBoss;
  private handler: ((job: WebhookJob) => Promise<void>) | null = null;

  constructor(databaseUrl: string) {
    this.boss = new PgBoss({
      connectionString: databaseUrl,
      max: 4,
    });
  }

  async start(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(WEBHOOK_QUEUE, {
      name: WEBHOOK_QUEUE,
      retryLimit: 8,
      retryDelay: 15,
      retryBackoff: true,
    });
  }

  async stop(): Promise<void> {
    await this.boss.stop();
  }

  async work(handler: (job: WebhookJob) => Promise<void>): Promise<void> {
    this.handler = handler;
    await this.boss.work<WebhookJob>(WEBHOOK_QUEUE, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }

  async enqueue(job: WebhookJob): Promise<void> {
    await this.boss.send(WEBHOOK_QUEUE, job, {
      singletonKey: job.webhookId,
      retryLimit: 8,
      retryDelay: 15,
      retryBackoff: true,
    });
  }

  async drain(): Promise<void> {
    if (!this.handler) return;
  }
}
