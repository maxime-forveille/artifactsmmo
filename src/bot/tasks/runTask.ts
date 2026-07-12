import type { ArtifactsClient } from "../../client/index.js";
import { waitUntil } from "../../utils/cooldown.js";
import { logger } from "../../utils/logger.js";
import type { CharacterAgent } from "../characters/characterAgent.js";
import { createCharacterAgent } from "../characters/characterAgent.js";
import { craftAndEquip } from "../strategies/equipment.js";
import { runFarmingCycle } from "../strategies/farming.js";

const RETRY_DELAY_MS = 10_000;

/**
 * What a character should be doing. `farm` runs forever; `craftAndEquip`
 * runs once. New task types should be added here first, then handled in
 * `runTask`'s switch (the `never` check below makes an unhandled case a
 * compile error rather than a silent no-op).
 */
export type Task =
  | { readonly type: "craftAndEquip"; readonly item: string }
  | { readonly type: "farm"; readonly resource: string };

const runFarmTask = async (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
  resourceCode: string,
): Promise<void> => {
  for (;;) {
    const result = await runFarmingCycle(client, agent, resourceCode);

    await result.match(
      async () => {
        logger.info(
          { character: characterName, resource: resourceCode },
          `${characterName}: farming cycle completed`,
        );
      },
      async (error) => {
        logger.error(error, `${characterName}: farming cycle failed, retrying shortly`);
        await waitUntil(new Date(Date.now() + RETRY_DELAY_MS).toISOString());
      },
    );
  }
};

const runCraftAndEquipTask = async (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
  itemCode: string,
): Promise<void> => {
  const result = await craftAndEquip(client, agent, itemCode);

  await result.match(
    async () => {
      logger.info(
        { character: characterName, item: itemCode },
        `${characterName}: crafted and equipped ${itemCode}`,
      );
    },
    async (error) => {
      logger.error(error, `${characterName}: failed to craft/equip ${itemCode}`);
    },
  );
};

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
        case "craftAndEquip": {
          await runCraftAndEquipTask(client, characterName, agent, task.item);
          return;
        }
        case "farm": {
          await runFarmTask(client, characterName, agent, task.resource);
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
