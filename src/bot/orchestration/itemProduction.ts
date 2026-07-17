import { err, ok, type Result } from 'neverthrow';

import type { components } from '../../client/schema.js';
import type {
  CraftItemActivity,
  DepositItemActivity,
  WithdrawItemActivity,
} from '../activities/activity.js';
import { heldQuantity } from '../inventory.js';
import { craftSkillLevel } from '../progression.js';

import type { CrewSnapshot } from './crewSnapshot.js';
import type {
  ActivityAssignment,
  OrchestratorState,
} from './orchestratorState.js';
import { reservedBankWithdrawalQuantity } from './reservationIntents.js';

type Character = CrewSnapshot['characters'][number];
type CraftSkill = components['schemas']['CraftSkill'];
type Item = Readonly<components['schemas']['ItemSchema']>;
type ItemProductionActivity =
  | CraftItemActivity
  | DepositItemActivity
  | WithdrawItemActivity;

export class ProduceItemTargetMismatchError extends Error {
  constructor(
    public readonly itemCode: string,
    public readonly goalItemCode: string,
  ) {
    super(
      `Resolved item ${itemCode} does not match production Goal target ${goalItemCode}`,
    );
    this.name = 'ProduceItemTargetMismatchError';
  }
}

export class InvalidProduceItemTargetError extends Error {
  constructor(public readonly itemCode: string) {
    super(`Item ${itemCode} has no recipe to craft it into stock`);
    this.name = 'InvalidProduceItemTargetError';
  }
}

export class NoEligibleProducerError extends Error {
  constructor(
    public readonly itemCode: string,
    public readonly skill: CraftSkill,
    public readonly requiredLevel: number,
  ) {
    super(
      `No character can craft ${itemCode}: ${skill} level ${requiredLevel} is required`,
    );
    this.name = 'NoEligibleProducerError';
  }
}

export type ItemProductionError =
  | InvalidProduceItemTargetError
  | NoEligibleProducerError
  | ProduceItemTargetMismatchError;

export type ItemProductionPlan = Readonly<{
  activities: readonly ActivityAssignment<ItemProductionActivity>[];
  state: OrchestratorState;
}>;

const unchangedPlan = (state: OrchestratorState): ItemProductionPlan => ({
  activities: [],
  state,
});

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

const reservedCharacterNames = (
  state: OrchestratorState,
): ReadonlySet<string> =>
  new Set(state.reservations.map((reservation) => reservation.characterName));

const heldMaterialCoverage = (
  character: Character,
  materials: readonly Readonly<components['schemas']['SimpleItemSchema']>[],
): number =>
  materials.reduce(
    (total, material) =>
      total +
      Math.min(material.quantity, heldQuantity(character, material.code)),
    0,
  );

const findBestProducer = (
  snapshot: CrewSnapshot,
  skill: CraftSkill,
  requiredLevel: number,
  materials: readonly Readonly<components['schemas']['SimpleItemSchema']>[],
  excludedCharacterNames: ReadonlySet<string> = new Set(),
): Character | undefined =>
  snapshot.characters
    .filter(
      (character) =>
        !excludedCharacterNames.has(character.name) &&
        craftSkillLevel(character, skill) >= requiredLevel,
    )
    .reduce<Character | undefined>((best, character) => {
      if (best === undefined) {
        return character;
      }

      const coverageDifference =
        heldMaterialCoverage(character, materials) -
        heldMaterialCoverage(best, materials);

      if (coverageDifference !== 0) {
        return coverageDifference > 0 ? character : best;
      }

      return character.name.localeCompare(best.name) < 0 ? character : best;
    }, undefined);

const findIdleHolder = (
  snapshot: CrewSnapshot,
  itemCode: string,
  excludedCharacterNames: ReadonlySet<string>,
): Character | undefined =>
  snapshot.characters.find(
    (character) =>
      !excludedCharacterNames.has(character.name) &&
      heldQuantity(character, itemCode) > 0,
  );

const isAnyHolderBusy = (snapshot: CrewSnapshot, itemCode: string): boolean =>
  snapshot.characters.some(
    (character) => heldQuantity(character, itemCode) > 0,
  );

/** Advances one produced-item stock Goal with at most one Activity. */
export const planItemProduction = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  item: Item,
): Result<ItemProductionPlan, ItemProductionError> => {
  const goal = state.goals[0];

  if (goal === undefined || goal.type !== 'produceItem') {
    return ok(unchangedPlan(state));
  }

  if (item.code !== goal.itemCode) {
    return err(new ProduceItemTargetMismatchError(item.code, goal.itemCode));
  }

  const craft = item.craft;
  if (
    craft?.skill === undefined ||
    craft.items === undefined ||
    craft.items.length === 0
  ) {
    return err(new InvalidProduceItemTargetError(item.code));
  }

  if (
    availableBankQuantity(snapshot, state, goal.itemCode) >=
    goal.minimumBankQuantity
  ) {
    return ok({
      activities: [],
      state: {
        goals: state.goals.filter((candidate) => candidate.id !== goal.id),
        reservations: state.reservations,
      },
    });
  }

  if (
    state.reservations.some((reservation) => reservation.goalId === goal.id)
  ) {
    return ok(unchangedPlan(state));
  }

  const requiredLevel = craft.level ?? 0;
  const reservedNames = reservedCharacterNames(state);

  if (
    findBestProducer(snapshot, craft.skill, requiredLevel, craft.items) ===
    undefined
  ) {
    return err(
      new NoEligibleProducerError(item.code, craft.skill, requiredLevel),
    );
  }

  const idleHolder = findIdleHolder(snapshot, item.code, reservedNames);
  if (idleHolder !== undefined) {
    const remaining =
      goal.minimumBankQuantity -
      availableBankQuantity(snapshot, state, goal.itemCode);
    const depositQuantity = Math.min(
      remaining,
      heldQuantity(idleHolder, item.code),
    );

    return ok({
      activities: [
        {
          activity: {
            itemCode: item.code,
            quantity: depositQuantity,
            type: 'depositItem',
          },
          characterName: idleHolder.name,
          consumes: [],
          goalId: goal.id,
          produces: [{ itemCode: item.code, quantity: depositQuantity }],
        },
      ],
      state,
    });
  }

  if (isAnyHolderBusy(snapshot, item.code)) {
    return ok(unchangedPlan(state));
  }

  const producer = findBestProducer(
    snapshot,
    craft.skill,
    requiredLevel,
    craft.items,
    reservedNames,
  );
  if (producer === undefined) {
    return ok(unchangedPlan(state));
  }

  const remaining =
    goal.minimumBankQuantity -
    availableBankQuantity(snapshot, state, goal.itemCode);
  const recipeQuantity = craft.quantity ?? 1;
  const batches = Math.ceil(remaining / recipeQuantity);

  for (const material of craft.items) {
    const requiredMaterialQuantity = material.quantity * batches;
    const missingQuantity = Math.max(
      requiredMaterialQuantity - heldQuantity(producer, material.code),
      0,
    );

    if (missingQuantity === 0) {
      continue;
    }

    const withdrawQuantity = Math.min(
      missingQuantity,
      availableBankQuantity(snapshot, state, material.code),
    );

    if (withdrawQuantity === 0) {
      return ok(unchangedPlan(state));
    }

    return ok({
      activities: [
        {
          activity: {
            itemCode: material.code,
            quantity: withdrawQuantity,
            type: 'withdrawItem',
          },
          characterName: producer.name,
          consumes: [{ itemCode: material.code, quantity: withdrawQuantity }],
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
        activity: { itemCode: item.code, quantity: batches, type: 'craftItem' },
        characterName: producer.name,
        consumes: craft.items.map((material) => ({
          itemCode: material.code,
          quantity: material.quantity * batches,
        })),
        goalId: goal.id,
        produces: [{ itemCode: item.code, quantity: batches * recipeQuantity }],
      },
    ],
    state,
  });
};
