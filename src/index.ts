import type { Task } from "./bot/tasks/task.js";
import { runTask } from "./bot/tasks/runTask.js";
import { bot } from "./client/index.js";
import { logger } from "./utils/logger.js";

// Automatically picks the highest-level monster that's still safe to
// fight (see findNextSafeMonster), re-evaluated every cycle - so a
// character naturally moves to a tougher target as it levels up.
const TASK: Task = { type: "autoHunt" };

const ASSIGNMENTS: readonly { readonly character: string; readonly task: Task }[] = [
  { character: "Cartman", task: TASK },
  { character: "Kyle", task: TASK },
  { character: "Kenny", task: TASK },
  { character: "Stan", task: TASK },
  { character: "Butters", task: TASK },
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
