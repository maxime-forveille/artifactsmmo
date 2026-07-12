import { bot } from "./client/index.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Artifacts MMO bot starting up");

  // Placeholder: replace with real character orchestration.
  void bot;
}

main().catch((error: unknown) => {
  logger.error(error, "Fatal error while running the bot");
  process.exitCode = 1;
});
