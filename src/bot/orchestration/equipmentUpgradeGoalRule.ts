import { combatMargin } from '../combat.js';
import { equippedItemInSlot, findBestCombatGearFromCatalog } from '../gear.js';
import { heldQuantity } from '../inventory.js';

import { findBestCombatTarget } from './combatProgression.js';
import type { GoalRule } from './goalPolicy.js';
import type { EquipItemGoal } from './orchestratorState.js';
import type { WorldKnowledge } from './worldKnowledge.js';

type Character = Parameters<GoalRule>[0]['snapshot']['characters'][number];
type Item = WorldKnowledge['items'][number];
type Monster = WorldKnowledge['monsters'][number];

export const createEquipItemGoalId = (
  characterName: string,
  itemCode: string,
): string => `equipItem:${characterName}:${itemCode}`;

const createEquipItemGoal = (
  characterName: string,
  itemCode: string,
): EquipItemGoal => ({
  characterName,
  id: createEquipItemGoalId(characterName, itemCode),
  itemCode,
  type: 'equipItem',
});

const afterRest = (character: Character): Character => ({
  ...character,
  hp: character.max_hp,
});

const findNextCombatChallenge = (
  character: Character,
  monsters: readonly Monster[],
): Monster | undefined =>
  monsters
    .filter((monster) => monster.level <= character.level)
    .toSorted(
      (left, right) =>
        left.level - right.level || left.code.localeCompare(right.code),
    )[0];

const isItemAvailable = (
  item: Item,
  context: Parameters<GoalRule>[0],
): boolean =>
  item.craft?.skill !== undefined ||
  context.snapshot.bank.some(
    (bankItem) => bankItem.code === item.code && bankItem.quantity > 0,
  ) ||
  context.snapshot.characters.some(
    (character) => heldQuantity(character, item.code) > 0,
  );

/**
 * Discovers one weapon upgrade when a character cannot safely fight any
 * level-appropriate monster. Later slices will extend this to other slots.
 */
export const proposeEquipmentUpgradeGoals: GoalRule = (context) =>
  context.snapshot.characters.flatMap((character) => {
    if (findBestCombatTarget(character, context.world.monsters) !== undefined) {
      return [];
    }

    const restedCharacter = afterRest(character);
    const monster = findNextCombatChallenge(
      restedCharacter,
      context.world.monsters,
    );

    if (monster === undefined) {
      return [];
    }

    const currentWeaponCode = equippedItemInSlot(character, 'weapon');
    const weapons = context.world.items.filter(
      (item) =>
        item.type === 'weapon' &&
        (item.code === currentWeaponCode ||
          (item.level <= character.level && isItemAvailable(item, context))),
    );
    const selection = findBestCombatGearFromCatalog(
      restedCharacter,
      monster,
      'weapon',
      weapons,
    );
    const currentMargin = combatMargin(restedCharacter, monster);

    if (selection === undefined || selection.margin <= currentMargin) {
      return [];
    }

    return [
      {
        goal: createEquipItemGoal(character.name, selection.item.code),
        reason: `${character.name} needs ${selection.item.code} to improve combat against ${monster.code}`,
        utility: selection.margin - currentMargin,
      },
    ];
  });
