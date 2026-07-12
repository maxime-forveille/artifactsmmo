import { type Task, runTask } from "./bot/tasks/runTask.js";
import { bot } from "./client/index.js";
import { logger } from "./utils/logger.js";

// Every level-1 equipment slot feasible without combat. Weapon-type items
// (copper_pickaxe/copper_axe/copper_dagger/fishing_net) all fill the same
// "weapon" slot, so only one is listed here - characters that already have
// a different weapon equipped simply skip it (see craftAndEquip's
// already-equipped check).
const FULL_LOADOUT: readonly string[] = [
  "copper_dagger",
  "wooden_shield",
  "copper_helmet",
  "copper_boots",
  "copper_ring",
];

const ASSIGNMENTS: readonly { readonly character: string; readonly task: Task }[] = [
  { character: "Cartman", task: { items: FULL_LOADOUT, type: "craftAndEquip" } },
  { character: "Kyle", task: { items: FULL_LOADOUT, type: "craftAndEquip" } },
  { character: "Kenny", task: { items: FULL_LOADOUT, type: "craftAndEquip" } },
  { character: "Stan", task: { items: FULL_LOADOUT, type: "craftAndEquip" } },
  { character: "Butters", task: { items: FULL_LOADOUT, type: "craftAndEquip" } },
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
