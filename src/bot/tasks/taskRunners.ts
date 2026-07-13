import { errAsync, okAsync } from "neverthrow";

import type { ArtifactsClient } from "../../client/index.js";
import { logger } from "../../utils/logger.js";
import type { CharacterAgent } from "../characters/characterAgent.js";
import { findBestGatheringTool } from "../gear.js";
import { findNextSafeMonster } from "../progression.js";
import { craftAndEquip } from "../strategies/equipment.js";
import { runFarmingCycle } from "../strategies/farming.js";
import { runHuntingCycle } from "../strategies/hunting.js";
import { runForever } from "./runForever.js";

export class NoSafeMonsterFoundError extends Error {
  constructor(level: number) {
    super(`No monster found that's safe to fight at or below level ${level}`);
    this.name = "NoSafeMonsterFoundError";
  }
}

/**
 * Equips the best available gathering tool for the skill `resourceCode`
 * requires (see `findBestGatheringTool`), if any exists at the character's
 * level. A no-op when no such tool is found. Failures (e.g. the resource
 * lookup or the craft/equip itself) are logged but never block farming -
 * the character just keeps whatever's currently equipped.
 */
const equipGatheringToolIfAvailable = async (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
  resourceCode: string,
): Promise<void> => {
  const result = await client
    .getResource(resourceCode)
    .andThen((response) =>
      findBestGatheringTool(client, response.data.skill, agent.getCharacter().level),
    )
    .andThen((tool) =>
      tool === undefined ? okAsync(undefined) : craftAndEquip(client, agent, tool.code),
    );

  result.match(
    () => {},
    (error) => {
      logger.error(
        error,
        `${characterName}: failed to equip a gathering tool for ${resourceCode}, continuing with current gear`,
      );
    },
  );
};

export const runFarmTask = async (
  client: ArtifactsClient,
  characterName: string,
  agent: CharacterAgent,
  resourceCode: string,
): Promise<void> => {
  await equipGatheringToolIfAvailable(client, characterName, agent, resourceCode);
  await runForever(characterName, "farming cycle", () =>
    runFarmingCycle(client, agent, resourceCode),
  );
};

export const runHuntTask = (
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
export const runAutoHuntTask = (
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
export const runCraftAndEquipTask = async (
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
