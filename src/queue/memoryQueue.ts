import type { JobQueue, WebhookJob } from "./types";

export class MemoryQueue implements JobQueue {
  private jobs: WebhookJob[] = [];
  private handler: ((job: WebhookJob) => Promise<void>) | null = null;

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async work(handler: (job: WebhookJob) => Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async enqueue(job: WebhookJob): Promise<void> {
    this.jobs.push(job);
  }

  pending(): number {
    return this.jobs.length;
  }

  async drain(): Promise<void> {
    if (!this.handler) return;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (job) await this.handler(job);
    }
  }
}
