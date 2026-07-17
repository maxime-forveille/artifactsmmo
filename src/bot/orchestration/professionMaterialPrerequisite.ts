import type { components } from '../../client/schema.js';
import { heldQuantity } from '../inventory.js';
import { craftSkillLevel } from '../progression.js';

import type { CrewSnapshot } from './crewSnapshot.js';
import type { GoalProposal } from './goalPolicy.js';
import type {
  OrchestratorState,
  ReachProfessionLevelGoal,
  ReplenishBankItemGoal,
} from './orchestratorState.js';
import { findBestProfessionRecipe } from './professionProgression.js';
import { reservedBankWithdrawalQuantity } from './reservationIntents.js';
import { findBestGatherer } from './resourceReplenishment.js';
import type { WorldKnowledge } from './worldKnowledge.js';

type Character = CrewSnapshot['characters'][number];
type Item = WorldKnowledge['items'][number];
type Resource = WorldKnowledge['resources'][number];
type SimpleItem = Readonly<components['schemas']['SimpleItemSchema']>;
type RecipeItem = Item &
  Readonly<{
    craft: NonNullable<Item['craft']> &
      Readonly<{ items: readonly SimpleItem[] }>;
  }>;

type GatherableMaterial = Readonly<{
  itemCode: string;
  missingQuantity: number;
  recipe: RecipeItem;
  resource: Resource;
}>;

export const createReplenishBankItemGoalId = (
  itemCode: string,
  minimumBankQuantity: number,
): string => `replenishBankItem:${itemCode}:${minimumBankQuantity}`;

const bankQuantity = (snapshot: CrewSnapshot, itemCode: string): number =>
  snapshot.bank
    .filter((item) => item.code === itemCode)
    .reduce((total, item) => total + item.quantity, 0);

const availableBankQuantity = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  itemCode: string,
): number =>
  Math.max(
    bankQuantity(snapshot, itemCode) -
      reservedBankWithdrawalQuantity(state, itemCode),
    0,
  );

const isEligibleRecipe = (
  item: Item,
  goal: ReachProfessionLevelGoal,
  currentLevel: number,
): item is RecipeItem =>
  item.craft?.skill === goal.skill &&
  (item.craft.level ?? 0) <= currentLevel &&
  item.craft.items !== undefined &&
  item.craft.items.length > 0;

const uniqueGatheringSource = (
  knowledge: WorldKnowledge,
  itemCode: string,
): Resource | undefined => {
  const resources = knowledge.resources.filter((resource) =>
    resource.drops.some((drop) => drop.code === itemCode),
  );
  const monsterSourceCount = knowledge.monsters.filter((monster) =>
    monster.drops.some((drop) => drop.code === itemCode),
  ).length;

  return resources.length === 1 && monsterSourceCount === 0
    ? resources[0]
    : undefined;
};

const findGatherableMaterial = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  character: Character,
  goal: ReachProfessionLevelGoal,
  knowledge: WorldKnowledge,
): GatherableMaterial | undefined => {
  const currentLevel = craftSkillLevel(character, goal.skill);
  const itemsByCode = new Map(
    knowledge.items.map((item) => [item.code, item] as const),
  );
  const recipes = knowledge.items
    .filter((item) => isEligibleRecipe(item, goal, currentLevel))
    .toSorted(
      (left, right) =>
        (right.craft.level ?? 0) - (left.craft.level ?? 0) ||
        left.code.localeCompare(right.code),
    );

  for (const recipe of recipes) {
    for (const material of recipe.craft.items) {
      const missingQuantity = Math.max(
        material.quantity - heldQuantity(character, material.code),
        0,
      );

      if (
        missingQuantity === 0 ||
        availableBankQuantity(snapshot, state, material.code) >= missingQuantity
      ) {
        continue;
      }

      const item = itemsByCode.get(material.code);
      if (item === undefined || item.craft?.skill !== undefined) {
        continue;
      }

      const resource = uniqueGatheringSource(knowledge, material.code);
      if (
        resource !== undefined &&
        findBestGatherer(snapshot, resource) !== undefined
      ) {
        return { itemCode: material.code, missingQuantity, recipe, resource };
      }
    }
  }

  return undefined;
};

const createReplenishmentGoal = (
  itemCode: string,
  minimumBankQuantity: number,
  resourceCode: string,
): ReplenishBankItemGoal => ({
  id: createReplenishBankItemGoalId(itemCode, minimumBankQuantity),
  itemCode,
  minimumBankQuantity,
  resourceCode,
  type: 'replenishBankItem',
});

/** Proposes one raw-material prerequisite for a blocked profession Goal. */
export const proposeProfessionMaterialPrerequisite = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  knowledge: WorldKnowledge,
): readonly GoalProposal[] => {
  const goal = state.goals.find(
    (candidate): candidate is typeof candidate & ReachProfessionLevelGoal =>
      candidate.type === 'reachProfessionLevel',
  );

  if (goal === undefined) {
    return [];
  }

  const character = snapshot.characters.find(
    (candidate) => candidate.name === goal.characterName,
  );
  if (
    character === undefined ||
    craftSkillLevel(character, goal.skill) >= goal.targetLevel ||
    state.reservations.some(
      (reservation) =>
        reservation.goalId === goal.id ||
        reservation.characterName === goal.characterName,
    ) ||
    findBestProfessionRecipe(snapshot, state, character, goal, knowledge) !==
      undefined
  ) {
    return [];
  }

  const material = findGatherableMaterial(
    snapshot,
    state,
    character,
    goal,
    knowledge,
  );
  if (material === undefined) {
    return [];
  }

  return [
    {
      configuredRank: -1,
      goal: createReplenishmentGoal(
        material.itemCode,
        material.missingQuantity,
        material.resource.code,
      ),
      parentGoalId: goal.id,
      reason: `${goal.characterName} needs ${material.missingQuantity}x ${material.itemCode} from ${material.resource.code} to craft ${material.recipe.code} for ${goal.skill} XP`,
      rule: 'professionProgression',
    },
  ];
};
