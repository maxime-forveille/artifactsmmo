import { type Task, runTask } from "./bot/tasks/runTask.js";
import { bot } from "./client/index.js";
import { logger } from "./utils/logger.js";

const ASSIGNMENTS: readonly { readonly character: string; readonly task: Task }[] = [
  { character: "Cartman", task: { items: ["copper_dagger"], type: "craftAndEquip" } },
  { character: "Kyle", task: { items: ["copper_dagger"], type: "craftAndEquip" } },
  { character: "Kenny", task: { items: ["copper_dagger"], type: "craftAndEquip" } },
  { character: "Stan", task: { items: ["copper_dagger"], type: "craftAndEquip" } },
  { character: "Butters", task: { items: ["copper_dagger"], type: "craftAndEquip" } },
];

async function main() {
  logger.info("Artifacts MMO bot starting up");

  await Promise.all(
    ASSIGNMENTS.map((assignment) => runTask(bot, assignment.character, assignment.task)),
  );
}

main().catch((error: unknown) => {
  logger.error(error, "Fatal error while running the bot");
  process.exitCode = 1;
});
