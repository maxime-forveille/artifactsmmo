import { okAsync, type ResultAsync } from "neverthrow";

import type { ArtifactsApiError, ArtifactsClient } from "../client/index.js";
import type { components } from "../client/schema.js";
import { averageDamagePerTurn, type OffensiveStats } from "./combat.js";

type Character = components["schemas"]["CharacterSchema"];
type GatheringSkill = components["schemas"]["GatheringSkill"];
type Item = components["schemas"]["ItemSchema"];
type Monster = components["schemas"]["MonsterSchema"];

type GearClient = Pick<ArtifactsClient, "getItems">;
type WeaponSelectionClient = Pick<ArtifactsClient, "getItem" | "getItems">;

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

// Effect codes that map 1:1 onto the OffensiveStats fields used by
// averageDamagePerTurn - this is how Artifacts MMO names weapon effects
// (e.g. copper_dagger grants `{code: "critical_strike", value: 35}`).
const OFFENSIVE_EFFECT_CODES = [
  "attack_air",
  "attack_earth",
  "attack_fire",
  "attack_water",
  "critical_strike",
  "dmg",
  "dmg_air",
  "dmg_earth",
  "dmg_fire",
  "dmg_water",
] as const;
type OffensiveEffectCode = (typeof OFFENSIVE_EFFECT_CODES)[number];

const isOffensiveEffectCode = (code: string): code is OffensiveEffectCode =>
  (OFFENSIVE_EFFECT_CODES as readonly string[]).includes(code);

/** The subset of `item`'s effects that feed into `averageDamagePerTurn`. */
const weaponContribution = (item: Item): Partial<Record<OffensiveEffectCode, number>> =>
  Object.fromEntries(
    (item.effects ?? [])
      .filter((effect) => isOffensiveEffectCode(effect.code))
      .map((effect) => [effect.code, effect.value]),
  );

/** `stats` with `contribution` added on top (or removed, when `sign` is -1). */
const withContribution = (
  stats: OffensiveStats,
  contribution: Partial<Record<OffensiveEffectCode, number>>,
  sign: 1 | -1,
): OffensiveStats => ({
  attack_air: stats.attack_air + sign * (contribution.attack_air ?? 0),
  attack_earth: stats.attack_earth + sign * (contribution.attack_earth ?? 0),
  attack_fire: stats.attack_fire + sign * (contribution.attack_fire ?? 0),
  attack_water: stats.attack_water + sign * (contribution.attack_water ?? 0),
  critical_strike: stats.critical_strike + sign * (contribution.critical_strike ?? 0),
  dmg: (stats.dmg ?? 0) + sign * (contribution.dmg ?? 0),
  dmg_air: (stats.dmg_air ?? 0) + sign * (contribution.dmg_air ?? 0),
  dmg_earth: (stats.dmg_earth ?? 0) + sign * (contribution.dmg_earth ?? 0),
  dmg_fire: (stats.dmg_fire ?? 0) + sign * (contribution.dmg_fire ?? 0),
  dmg_water: (stats.dmg_water ?? 0) + sign * (contribution.dmg_water ?? 0),
});

/**
 * Finds the best combat weapon for fighting `monster`, among weapons
 * equippable at `maxLevel` or below. Starts from `character`'s stats with
 * their *currently* equipped weapon's contribution removed (so a weapon
 * already equipped is compared on equal footing with every other
 * candidate), adds each candidate's contribution back in, and picks
 * whichever yields the highest `averageDamagePerTurn` against `monster`.
 * Returns undefined if no candidate deals any damage at all (e.g. every
 * weapon found is elementally resisted).
 */
export const findBestCombatWeapon = (
  client: WeaponSelectionClient,
  character: Character,
  monster: Monster,
  maxLevel: number,
): ResultAsync<Item | undefined, ArtifactsApiError> => {
  const currentWeaponCode = character.weapon_slot;

  const currentWeapon$: ResultAsync<Item | undefined, ArtifactsApiError> =
    currentWeaponCode === undefined || currentWeaponCode === ""
      ? okAsync(undefined)
      : client.getItem(currentWeaponCode).map((response) => response.data);

  return currentWeapon$.andThen((currentWeapon) => {
    const baseStats = withContribution(
      character,
      currentWeapon === undefined ? {} : weaponContribution(currentWeapon),
      -1,
    );

    return client.getItems({ max_level: maxLevel, size: 100, type: "weapon" }).map((page) => {
      const ranked = page.data.map((candidate) => ({
        damage: averageDamagePerTurn(
          withContribution(baseStats, weaponContribution(candidate), 1),
          monster,
        ),
        item: candidate,
      }));

      return ranked.reduce<{ readonly damage: number; readonly item: Item } | undefined>(
        (best, candidate) =>
          candidate.damage > 0 && (best === undefined || candidate.damage > best.damage)
            ? candidate
            : best,
        undefined,
      )?.item;
    });
  });
};
