import { errAsync, type ResultAsync } from "neverthrow";

import type { ArtifactsClient } from "../../client/index.js";
import { waitUntil } from "../../utils/cooldown.js";
import { logger } from "../../utils/logger.js";
import type { CharacterAgent } from "../characters/characterAgent.js";
import { createCharacterAgent } from "../characters/characterAgent.js";
import { findNextSafeMonster } from "../progression.js";
import { craftAndEquip } from "../strategies/equipment.js";
import { runFarmingCycle } from "../strategies/farming.js";
import { runHuntingCycle } from "../strategies/hunting.js";

const RETRY_DELAY_MS = 10_000;

export class NoSafeMonsterFoundError extends Error {
  constructor(level: number) {
    super(`No monster found that's safe to fight at or below level ${level}`);
    this.name = "NoSafeMonsterFoundError";
  }
}

/**
 * What a character should be doing. `farm`, `hunt`, and `autoHunt` run
 * forever; `craftAndEquip` works through `items` in order, then stops;
 * `craftAndEquipThenHunt` does the same craftAndEquip pass (a no-op for
 * items already equipped) and then switches to hunting forever - the
 * "get geared up, then go fight" combo. `autoHunt` is like `hunt`, but
 * re-picks the monster before every cycle instead of using a fixed one
 * (see `findNextSafeMonster`), so a character naturally moves to a better
 * target as it levels up. New task types should be added here first, then
 * handled in `runTask`'s switch (the `never` check below makes an
 * unhandled case a compile error rather than a silent no-op).
 */
export type Task =
  | { readonly type: "autoHunt" }
  | { readonly type: "craftAndEquip"; readonly items: readonly string[] }
  | {
      readonly type: "craftAndEquipThenHunt";
      readonly items: readonly string[];
      readonly monster: string;
    }
  | { readonly type: "farm"; readonly resource: string }
  | { readonly type: "hunt"; readonly monster: string };

/**
 * Runs `cycle()` forever, logging its outcome each time and waiting
 * `RETRY_DELAY_MS` before retrying after a failure.
 */
const runForever = async <E extends Error>(
  characterName: string,
  label: string,
  cycle: () => ResultAsync<void, E>,
): Promise<void> => {
  for (;;) {
    const result = await cycle();

    await result.match(
      async () => {
        logger.info({ character: characterName }, `${characterName}: ${label} completed`);
      },
      async (error) => {
        // pino's overloaded error() signature doesn't resolve well against a
        // generic error type; the `E extends Error` constraint above makes
        // this cast sound.
        logger.error(error as Error, `${characterName}: ${label} failed, retrying shortly`);
        await waitUntil(new Date(Date.now() + RETRY_DELAY_MS).toISOString());
      },
    );
  }
};

const runFarmTask = (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
  resourceCode: string,
): Promise<void> =>
  runForever(characterName, "farming cycle", () => runFarmingCycle(client, agent, resourceCode));

const runHuntTask = (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
  monsterCode: string,
): Promise<void> =>
  runForever(characterName, "hunting cycle", () => runHuntingCycle(client, agent, monsterCode));

/**
 * Same as a fixed `hunt`, but re-picks the safest, highest-level monster
 * before every cycle instead of using a fixed code (see
 * `findNextSafeMonster`). When nothing is currently safe to fight, that's
 * treated the same as any other cycle failure: logged and retried shortly
 * (equipment upgrades to make more monsters safe aren't automated yet -
 * see the README's roadmap).
 */
const runAutoHuntTask = (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
): Promise<void> =>
  runForever(characterName, "auto-hunt cycle", () =>
    findNextSafeMonster(client, agent.getCharacter()).andThen((monster) =>
      monster === undefined
        ? errAsync(new NoSafeMonsterFoundError(agent.getCharacter().level))
        : runHuntingCycle(client, agent, monster.code),
    ),
  );

/**
 * Crafts and equips each item in `items`, one after another. A failure on
 * one item is logged but doesn't stop the rest of the list (e.g. so a
 * ring recipe hiccup doesn't prevent the character from still getting
 * their boots).
 */
const runCraftAndEquipTask = async (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
  items: readonly string[],
): Promise<void> => {
  for (const itemCode of items) {
    const result = await craftAndEquip(client, agent, itemCode);

    await result.match(
      async () => {
        logger.info(
          { character: characterName, item: itemCode },
          `${characterName}: crafted and equipped ${itemCode}`,
        );
      },
      async (error) => {
        logger.error(error, `${characterName}: failed to craft/equip ${itemCode}, moving on`);
      },
    );
  }
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
