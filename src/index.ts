import { type Task, runTask } from "./bot/tasks/runTask.js";
import { bot } from "./client/index.js";
import { logger } from "./utils/logger.js";

const ASSIGNMENTS: readonly { readonly character: string; readonly task: Task }[] = [
  { character: "Cartman", task: { item: "copper_pickaxe", type: "craftAndEquip" } },
  { character: "Kyle", task: { item: "copper_dagger", type: "craftAndEquip" } },
  { character: "Kenny", task: { item: "copper_helmet", type: "craftAndEquip" } },
  { character: "Stan", task: { item: "copper_axe", type: "craftAndEquip" } },
  { character: "Butters", task: { item: "wooden_shield", type: "craftAndEquip" } },
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
