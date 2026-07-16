import { err, ok, type Result } from "neverthrow";

import type { components } from "../../client/schema.js";
import type {
  CraftItemActivity,
  EquipItemActivity,
  FarmResourceActivity,
  HuntMonsterActivity,
  WithdrawItemActivity,
} from "../activities/activity.js";
import { combatMargin, isSafeToFight } from "../combat.js";
import { EQUIP_SLOT_BY_ITEM_TYPE, equippedItemInSlot } from "../gear.js";
import { heldQuantity } from "../inventory.js";
import { craftSkillLevel } from "../progression.js";
import type { CrewSnapshot } from "./crewSnapshot.js";
import type { ActivityAssignment, OrchestratorState } from "./orchestratorState.js";
import { findBestGatherer, NoEligibleGathererError } from "./resourceReplenishment.js";

type Character = Readonly<components["schemas"]["CharacterSchema"]>;
type Item = Readonly<components["schemas"]["ItemSchema"]>;
type Monster = Readonly<components["schemas"]["MonsterSchema"]>;
type Resource = Readonly<components["schemas"]["ResourceSchema"]>;
type EquipmentActivity =
  | CraftItemActivity
  | EquipItemActivity
  | FarmResourceActivity
  | HuntMonsterActivity
  | WithdrawItemActivity;

export type EquipmentMaterialSource = Readonly<{
  itemCode: string;
  source:
    | Readonly<{ monster: Monster; type: "hunt" }>
    | Readonly<{ resource: Resource; type: "gather" }>;
}>;

export type EquipmentProgressionPlan = Readonly<{
  activities: readonly ActivityAssignment<EquipmentActivity>[];
  state: OrchestratorState;
}>;

export type PreviousActivityOutcome = Readonly<{
  event: Readonly<{
    goalId: string;
    type: "blocked" | "cancelled" | "completed";
  }>;
}>;

export class EquipmentCharacterNotFoundError extends Error {
  constructor(public readonly characterName: string) {
    super(`Character "${characterName}" does not exist in the Crew Snapshot`);
    this.name = "EquipmentCharacterNotFoundError";
  }
}

export class InvalidEquipmentTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEquipmentTargetError";
  }
}

export class InvalidEquipmentMaterialSourceError extends Error {
  constructor(
    public readonly itemCode: string,
    public readonly sourceCode: string,
  ) {
    super(`Source ${sourceCode} does not produce equipment material ${itemCode}`);
    this.name = "InvalidEquipmentMaterialSourceError";
  }
}

export class NoSafeEquipmentMaterialHunterError extends Error {
  constructor(
    public readonly itemCode: string,
    public readonly monsterCode: string,
  ) {
    super(`No character can safely hunt ${monsterCode} for ${itemCode}`);
    this.name = "NoSafeEquipmentMaterialHunterError";
  }
}

export type EquipmentProgressionError =
  | EquipmentCharacterNotFoundError
  | InvalidEquipmentMaterialSourceError
  | InvalidEquipmentTargetError
  | NoEligibleGathererError
  | NoSafeEquipmentMaterialHunterError;

const bankQuantity = (snapshot: CrewSnapshot, itemCode: string): number =>
  snapshot.bank
    .filter((item) => item.code === itemCode)
    .reduce((total, item) => total + item.quantity, 0);

const unchangedPlan = (state: OrchestratorState): EquipmentProgressionPlan => ({
  activities: [],
  state,
});

type MissingDirectMaterial = Readonly<{
  bankedQuantity: number;
  itemCode: string;
  missingQuantity: number;
}>;

type EquipmentStep = Readonly<{
  activity: EquipmentActivity;
  characterName: string;
  consumes: readonly { itemCode: string }[];
  produces: readonly { itemCode: string }[];
}>;

const missingDirectMaterialFor = (
  snapshot: CrewSnapshot,
  character: Character,
  item: Item,
): MissingDirectMaterial | undefined =>
  (item.craft?.items ?? [])
    .map((material): MissingDirectMaterial => {
      const missingQuantity = Math.max(
        material.quantity - heldQuantity(character, material.code),
        0,
      );

      return {
        bankedQuantity: Math.min(missingQuantity, bankQuantity(snapshot, material.code)),
        itemCode: material.code,
        missingQuantity,
      };
    })
    .find((material) => material.missingQuantity > 0);

const reservedCharacterNames = (state: OrchestratorState): ReadonlySet<string> =>
  new Set(state.reservations.map((reservation) => reservation.characterName));

const afterRest = (character: Character): Character => ({
  ...character,
  hp: character.max_hp,
});

const findBestHunter = (
  snapshot: CrewSnapshot,
  monster: Monster,
  excludedCharacterNames: ReadonlySet<string> = new Set(),
): Character | undefined =>
  snapshot.characters
    .filter(
      (character) =>
        !excludedCharacterNames.has(character.name) && isSafeToFight(afterRest(character), monster),
    )
    .reduce<Character | undefined>((best, character) => {
      if (best === undefined) {
        return character;
      }

      const marginDifference =
        combatMargin(afterRest(character), monster) - combatMargin(afterRest(best), monster);

      if (marginDifference !== 0) {
        return marginDifference > 0 ? character : best;
      }

      return character.name.localeCompare(best.name) < 0 ? character : best;
    }, undefined);

const acquisitionStepFor = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  material: MissingDirectMaterial,
  resolved: EquipmentMaterialSource,
): Result<EquipmentStep | undefined, EquipmentProgressionError> => {
  if (resolved.source.type === "gather") {
    const { resource } = resolved.source;

    if (!resource.drops.some((drop) => drop.code === material.itemCode)) {
      return err(new InvalidEquipmentMaterialSourceError(material.itemCode, resource.code));
    }

    const eligibleGatherer = findBestGatherer(snapshot, resource);

    if (eligibleGatherer === undefined) {
      return err(new NoEligibleGathererError(resource.code, resource.skill, resource.level));
    }

    const gatherer = findBestGatherer(snapshot, resource, reservedCharacterNames(state));

    return ok(
      gatherer === undefined
        ? undefined
        : {
            activity: { resourceCode: resource.code, type: "farmResource" },
            characterName: gatherer.name,
            consumes: [],
            produces: [{ itemCode: material.itemCode }],
          },
    );
  }

  const { monster } = resolved.source;

  if (!monster.drops.some((drop) => drop.code === material.itemCode)) {
    return err(new InvalidEquipmentMaterialSourceError(material.itemCode, monster.code));
  }

  const eligibleHunter = findBestHunter(snapshot, monster);

  if (eligibleHunter === undefined) {
    return err(new NoSafeEquipmentMaterialHunterError(material.itemCode, monster.code));
  }

  const hunter = findBestHunter(snapshot, monster, reservedCharacterNames(state));

  return ok(
    hunter === undefined
      ? undefined
      : {
          activity: { monsterCode: monster.code, type: "huntMonster" },
          characterName: hunter.name,
          consumes: [],
          produces: [{ itemCode: material.itemCode }],
        },
  );
};

/**
 * Advances one explicit equipment Goal by one bounded step. A blocked step is
 * left idle for the next planner layer to turn into prerequisite Goals.
 */
export const planEquipmentProgression = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  item: Item,
  previousOutcome?: PreviousActivityOutcome,
  resolvedSources: readonly EquipmentMaterialSource[] = [],
): Result<EquipmentProgressionPlan, EquipmentProgressionError> => {
  const goal = state.goals[0];

  if (goal === undefined || goal.type !== "equipItem") {
    return ok(unchangedPlan(state));
  }

  if (item.code !== goal.itemCode) {
    return err(
      new InvalidEquipmentTargetError(
        `Resolved item ${item.code} does not match equipment Goal target ${goal.itemCode}`,
      ),
    );
  }

  const slot = EQUIP_SLOT_BY_ITEM_TYPE[item.type];

  if (slot === undefined) {
    return err(
      new InvalidEquipmentTargetError(
        `Item ${item.code} has unsupported equipment type ${item.type}`,
      ),
    );
  }

  const character = snapshot.characters.find((candidate) => candidate.name === goal.characterName);

  if (character === undefined) {
    return err(new EquipmentCharacterNotFoundError(goal.characterName));
  }

  if (equippedItemInSlot(character, slot) === item.code) {
    return ok({
      activities: [],
      state: {
        goals: state.goals.filter((candidate) => candidate.id !== goal.id),
        reservations: state.reservations,
      },
    });
  }

  if (
    state.reservations.some(
      (reservation) =>
        reservation.goalId === goal.id || reservation.characterName === goal.characterName,
    )
  ) {
    return ok(unchangedPlan(state));
  }

  if (previousOutcome?.event.type === "blocked" && previousOutcome.event.goalId === goal.id) {
    return ok(unchangedPlan(state));
  }

  if (heldQuantity(character, item.code) > 0) {
    return ok({
      activities: [
        {
          activity: { itemCode: item.code, type: "equipItem" },
          characterName: character.name,
          consumes: [{ itemCode: item.code }],
          goalId: goal.id,
          produces: [],
        },
      ],
      state,
    });
  }

  if (bankQuantity(snapshot, item.code) > 0) {
    return ok({
      activities: [
        {
          activity: { itemCode: item.code, quantity: 1, type: "withdrawItem" },
          characterName: character.name,
          consumes: [{ itemCode: item.code }],
          goalId: goal.id,
          produces: [],
        },
      ],
      state,
    });
  }

  const missingMaterial = missingDirectMaterialFor(snapshot, character, item);
  const craftingSkill = item.craft?.skill;
  const canCraftTarget =
    craftingSkill !== undefined &&
    craftSkillLevel(character, craftingSkill) >= (item.craft?.level ?? 0);

  if (missingMaterial !== undefined && canCraftTarget) {
    if (missingMaterial.bankedQuantity > 0) {
      const activity: WithdrawItemActivity = {
        itemCode: missingMaterial.itemCode,
        quantity: missingMaterial.bankedQuantity,
        type: "withdrawItem",
      };

      return ok({
        activities: [
          {
            activity,
            characterName: character.name,
            consumes: [{ itemCode: activity.itemCode }],
            goalId: goal.id,
            produces: [],
          },
        ],
        state,
      });
    }

    const resolvedSource = resolvedSources.find(
      (candidate) => candidate.itemCode === missingMaterial.itemCode,
    );

    if (resolvedSource !== undefined) {
      const acquisition = acquisitionStepFor(snapshot, state, missingMaterial, resolvedSource);

      if (acquisition.isErr()) {
        return err(acquisition.error);
      }

      return acquisition.value === undefined
        ? ok(unchangedPlan(state))
        : ok({
            activities: [{ ...acquisition.value, goalId: goal.id }],
            state,
          });
    }
  }

  const step: EquipmentStep =
    item.craft?.skill !== undefined
      ? {
          activity: { itemCode: item.code, quantity: 1, type: "craftItem" },
          characterName: character.name,
          consumes: [],
          produces: [{ itemCode: item.code }],
        }
      : {
          activity: { itemCode: item.code, type: "equipItem" },
          characterName: character.name,
          consumes: [{ itemCode: item.code }],
          produces: [],
        };

  return ok({ activities: [{ ...step, goalId: goal.id }], state });
};
