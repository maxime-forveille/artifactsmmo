import type { ResultAsync } from "neverthrow";

import type { ArtifactsApiError, ArtifactsClient } from "../client/index.js";
import type { components } from "../client/schema.js";

type GatheringSkill = components["schemas"]["GatheringSkill"];
type Item = components["schemas"]["ItemSchema"];

type GearClient = Pick<ArtifactsClient, "getItems">;

/** The effect value granting `skill` on `item`, or undefined if it has none. */
const gatheringEffectValue = (item: Item, skill: GatheringSkill): number | undefined =>
  item.effects?.find((effect) => effect.code === skill)?.value;

/**
 * Finds the best gathering tool for `skill` (mining/woodcutting/fishing/
 * alchemy) among weapons equippable at `maxLevel` or below. Artifacts MMO
 * models tools as weapons with an effect whose code matches the gathering
 * skill and a negative value (e.g. copper_pickaxe has
 * `{code: "mining", value: -10}`, a 10% gathering cooldown reduction).
 * Picks the item with the largest reduction; returns undefined if no
 * equippable weapon grants one.
 */
export const findBestGatheringTool = (
  client: GearClient,
  skill: GatheringSkill,
  maxLevel: number,
): ResultAsync<Item | undefined, ArtifactsApiError> =>
  client.getItems({ max_level: maxLevel, size: 100, type: "weapon" }).map((page) =>
    page.data.reduce<Item | undefined>((best, candidate) => {
      const candidateValue = gatheringEffectValue(candidate, skill);

      if (candidateValue === undefined || candidateValue >= 0) {
        return best;
      }

      const bestValue = best === undefined ? undefined : gatheringEffectValue(best, skill);

      return bestValue === undefined || candidateValue < bestValue ? candidate : best;
    }, undefined),
  );
