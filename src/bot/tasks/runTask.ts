import type { ArtifactsClient } from "../../client/index.js";
import { logger } from "../../utils/logger.js";
import { createCharacterAgent } from "../characters/characterAgent.js";
import type { Task } from "./task.js";
import { runAutoHuntTask, runCraftAndEquipTask, runFarmTask, runHuntTask } from "./taskRunners.js";

/**
 * Creates a character agent and runs `task` on it. Agent creation failures
 * are logged, not thrown, so one character failing to start doesn't take
 * down whichever other tasks are running alongside it (see index.ts, which
 * runs one `runTask` per character via `Promise.all`).
 */
export const runTask = async (
  client: ArtifactsClient,
  characterName: string,
  task: Task,
): Promise<void> => {
  const agentResult = await createCharacterAgent(client, characterName);

  await agentResult.match(
    async (agent) => {
      switch (task.type) {
        case "autoHunt": {
          await runAutoHuntTask(client, characterName, agent);
          return;
        }
        case "craftAndEquip": {
          await runCraftAndEquipTask(client, characterName, agent, task.items);
          return;
        }
        case "craftAndEquipThenHunt": {
          await runCraftAndEquipTask(client, characterName, agent, task.items);
          await runHuntTask(client, characterName, agent, task.monster);
          return;
        }
        case "farm": {
          await runFarmTask(client, characterName, agent, task.resource);
          return;
        }
        case "hunt": {
          await runHuntTask(client, characterName, agent, task.monster);
          return;
        }
        default: {
          const exhaustiveCheck: never = task;
          throw new Error(`Unhandled task type: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    },
    async (error) => {
      logger.error(error, `${characterName}: failed to create character agent`);
    },
  );
};
