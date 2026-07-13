import { type Task, runTask } from "./bot/tasks/runTask.js";
import { bot } from "./client/index.js";
import { logger } from "./utils/logger.js";

const ASSIGNMENTS: readonly { readonly character: string; readonly task: Task }[] = [
  { character: "Cartman", task: { resource: "copper_rocks", type: "farm" } },
  { character: "Kyle", task: { resource: "ash_tree", type: "farm" } },
  { character: "Kenny", task: { resource: "sunflower_field", type: "farm" } },
  { character: "Stan", task: { resource: "gudgeon_spot", type: "farm" } },
  { character: "Butters", task: { resource: "copper_rocks", type: "farm" } },
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
