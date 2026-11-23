import "dotenv/config";
import { configPresence, loadConfigFromProcess, RECALL_REGION } from "./config/env";
import { createPrismaClient, PrismaRepository } from "./db/prismaRepository";
import { createApp } from "./http/app";
import { PgBossQueue } from "./queue/pgBossQueue";
import { RecallClient } from "./recall/client";
import { loadBotBackground } from "./domain/video";
import { runSmoke } from "./smoke";

async function main(): Promise<void> {
  if (process.argv.includes("--smoke")) {
    await runSmoke();
    return;
  }

  const config = loadConfigFromProcess();
  console.log(`RECALL_REGION=${RECALL_REGION}`);
  console.log(`Recall API ${config.recallApiBaseUrl}`);
  console.log(`Webhook endpoint ${config.publicApiBaseUrl}/api/recall/webhook`);
  const presence = configPresence(config, process.env);
  console.log(`Config present ${JSON.stringify(presence)}`);

  const background = loadBotBackground();
  const prisma = createPrismaClient(config.databaseUrl);
  const repo = new PrismaRepository(prisma);
  const queue = new PgBossQueue(config.databaseUrl);
  const recall = new RecallClient({ apiKey: config.recallApiKey });
  const { app, processJob } = await createApp({
    config,
    repo,
    queue,
    recall,
    jpegBase64: background.base64,
  });

  await queue.start();
  await queue.work(processJob);
  const shutdown = async () => {
    await app.close();
    await queue.stop();
    await prisma.$disconnect();
  };
  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Startup failed.";
  console.error(message);
  process.exit(1);
});
