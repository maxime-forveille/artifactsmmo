import { err, ok, type Result } from 'neverthrow';

import type { components } from '../../client/schema.js';
import { heldQuantity } from '../inventory.js';
import { craftSkillLevel } from '../progression.js';

import type { CrewSnapshot } from './crewSnapshot.js';
import type {
  ActivityAssignment,
  OrchestratorState,
  ReachProfessionLevelGoal,
} from './orchestratorState.js';
import { reservedBankWithdrawalQuantity } from './reservationIntents.js';
import type { WorldKnowledge } from './worldKnowledge.js';

type Character = CrewSnapshot['characters'][number];
type Item = WorldKnowledge['items'][number];
type SimpleItem = Readonly<components['schemas']['SimpleItemSchema']>;
type ProfessionKnowledge = Pick<WorldKnowledge, 'items'>;
type ProfessionRecipeItem = Item &
  Readonly<{
    craft: NonNullable<Item['craft']> &
      Readonly<{ items: readonly SimpleItem[]; quantity: number }>;
  }>;

export class ProfessionCharacterNotFoundError extends Error {
  constructor(public readonly characterName: string) {
    super(`Character "${characterName}" does not exist in the Crew Snapshot`);
    this.name = 'ProfessionCharacterNotFoundError';
  }
}

export type ProfessionProgressionPlan = Readonly<{
  activities: readonly ActivityAssignment[];
  state: OrchestratorState;
}>;

export type ProfessionRecipeSelection = Readonly<{
  item: ProfessionRecipeItem;
  missingMaterials: readonly SimpleItem[];
  recipeLevel: number;
}>;

const unchangedPlan = (
  state: OrchestratorState,
): ProfessionProgressionPlan => ({ activities: [], state });

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

const missingMaterialsFor = (
  character: Character,
  item: ProfessionRecipeItem,
): readonly SimpleItem[] =>
  item.craft.items.flatMap((material) => {
    const missingQuantity = Math.max(
      material.quantity - heldQuantity(character, material.code),
      0,
    );

    return missingQuantity === 0
      ? []
      : [{ code: material.code, quantity: missingQuantity }];
  });

const missingMaterialQuantity = (
  selection: ProfessionRecipeSelection,
): number =>
  selection.missingMaterials.reduce(
    (total, material) => total + material.quantity,
    0,
  );

/** Selects one immediately supportable recipe with a deterministic heuristic. */
export const findBestProfessionRecipe = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  character: Character,
  goal: ReachProfessionLevelGoal,
  knowledge: ProfessionKnowledge,
): ProfessionRecipeSelection | undefined => {
  const currentLevel = craftSkillLevel(character, goal.skill);

  return knowledge.items
    .flatMap((item): readonly ProfessionRecipeSelection[] => {
      const craft = item.craft;
      const recipeLevel = craft?.level ?? 0;
      const recipeMaterials = craft?.items;

      if (
        craft?.skill !== goal.skill ||
        recipeLevel > currentLevel ||
        recipeMaterials === undefined ||
        recipeMaterials.length === 0
      ) {
        return [];
      }

      const recipeItem: ProfessionRecipeItem = {
        ...item,
        craft: {
          ...craft,
          items: recipeMaterials,
          quantity: craft.quantity ?? 1,
        },
      };
      const missingMaterials = missingMaterialsFor(character, recipeItem);
      const hasAvailableMaterials = missingMaterials.every(
        (material) =>
          availableBankQuantity(snapshot, state, material.code) >=
          material.quantity,
      );

      return hasAvailableMaterials
        ? [{ item: recipeItem, missingMaterials, recipeLevel }]
        : [];
    })
    .toSorted(
      (left, right) =>
        missingMaterialQuantity(left) - missingMaterialQuantity(right) ||
        right.recipeLevel - left.recipeLevel ||
        left.item.code.localeCompare(right.item.code),
    )[0];
};

const isGoalReserved = (
  state: OrchestratorState,
  goal: ReachProfessionLevelGoal,
): boolean =>
  state.reservations.some(
    (reservation) =>
      reservation.goalId === goal.id ||
      reservation.characterName === goal.characterName,
  );

/** Advances one profession Goal with at most one withdrawal or craft Activity. */
export const planProfessionProgression = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  knowledge: ProfessionKnowledge,
): Result<ProfessionProgressionPlan, ProfessionCharacterNotFoundError> => {
  const goal = state.goals[0];

  if (goal === undefined || goal.type !== 'reachProfessionLevel') {
    return ok(unchangedPlan(state));
  }

  const character = snapshot.characters.find(
    (candidate) => candidate.name === goal.characterName,
  );

  if (character === undefined) {
    return err(new ProfessionCharacterNotFoundError(goal.characterName));
  }

  if (craftSkillLevel(character, goal.skill) >= goal.targetLevel) {
    return ok({
      activities: [],
      state: {
        goals: state.goals.filter((candidate) => candidate.id !== goal.id),
        reservations: state.reservations,
      },
    });
  }

  if (isGoalReserved(state, goal)) {
    return ok(unchangedPlan(state));
  }

  const selection = findBestProfessionRecipe(
    snapshot,
    state,
    character,
    goal,
    knowledge,
  );

  if (selection === undefined) {
    return ok(unchangedPlan(state));
  }

  const missingMaterial = selection.missingMaterials[0];

  if (missingMaterial !== undefined) {
    return ok({
      activities: [
        {
          activity: {
            itemCode: missingMaterial.code,
            quantity: missingMaterial.quantity,
            type: 'withdrawItem',
          },
          characterName: character.name,
          consumes: [
            {
              itemCode: missingMaterial.code,
              quantity: missingMaterial.quantity,
            },
          ],
          goalId: goal.id,
          produces: [],
        },
      ],
      state,
    });
  }

  return ok({
    activities: [
      {
        activity: {
          itemCode: selection.item.code,
          quantity: 1,
          type: 'craftItem',
        },
        characterName: character.name,
        consumes: selection.item.craft.items.map((material) => ({
          itemCode: material.code,
          quantity: material.quantity,
        })),
        goalId: goal.id,
        produces: [
          {
            itemCode: selection.item.code,
            quantity: selection.item.craft.quantity,
          },
        ],
      },
    ],
    state,
  });
};
