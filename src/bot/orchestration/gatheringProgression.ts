import { err, ok, type Result } from 'neverthrow';

import type { FarmResourceActivity } from '../activities/activity.js';
import { skillLevel } from '../progression.js';

import type { CrewSnapshot } from './crewSnapshot.js';
import type {
  ActivityAssignment,
  OrchestratorState,
  ReachGatheringLevelGoal,
} from './orchestratorState.js';
import type { WorldKnowledge } from './worldKnowledge.js';

type GatheringKnowledge = Pick<WorldKnowledge, 'resources'>;
type Resource = WorldKnowledge['resources'][number];

export class GatheringCharacterNotFoundError extends Error {
  constructor(public readonly characterName: string) {
    super(`Character "${characterName}" does not exist in the Crew Snapshot`);
    this.name = 'GatheringCharacterNotFoundError';
  }
}

export class GatheringResourceNotResolvedError extends Error {
  constructor(public readonly resourceCode: string) {
    super(`Resource "${resourceCode}" does not exist in World Knowledge`);
    this.name = 'GatheringResourceNotResolvedError';
  }
}

export class InvalidGatheringResourceTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGatheringResourceTargetError';
  }
}

export type GatheringProgressionError =
  | GatheringCharacterNotFoundError
  | GatheringResourceNotResolvedError
  | InvalidGatheringResourceTargetError;

export type GatheringProgressionPlan = Readonly<{
  activities: readonly ActivityAssignment<FarmResourceActivity>[];
  state: OrchestratorState;
}>;

const unchangedPlan = (state: OrchestratorState): GatheringProgressionPlan => ({
  activities: [],
  state,
});

const isGoalReserved = (
  state: OrchestratorState,
  goal: ReachGatheringLevelGoal,
): boolean =>
  state.reservations.some(
    (reservation) =>
      reservation.characterName === goal.characterName ||
      reservation.goalId === goal.id,
  );

const validateResource = (
  characterName: string,
  currentLevel: number,
  goal: ReachGatheringLevelGoal,
  resource: Resource,
): Result<void, InvalidGatheringResourceTargetError> => {
  if (resource.skill !== goal.skill) {
    return err(
      new InvalidGatheringResourceTargetError(
        `${resource.code} does not use ${goal.skill}`,
      ),
    );
  }

  if (resource.level > currentLevel) {
    return err(
      new InvalidGatheringResourceTargetError(
        `${characterName} has ${goal.skill} level ${currentLevel}, but ${resource.code} requires ${resource.level}`,
      ),
    );
  }

  return ok(undefined);
};

const producedItems = (resource: Resource) =>
  [...new Set(resource.drops.map((drop) => drop.code))].map((itemCode) => ({
    itemCode,
  }));

/** Advances one finite gathering Goal with one bounded farming Activity. */
export const planGatheringProgression = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
  knowledge: GatheringKnowledge,
): Result<GatheringProgressionPlan, GatheringProgressionError> => {
  const goal = state.goals[0];
  if (goal === undefined || goal.type !== 'reachGatheringLevel') {
    return ok(unchangedPlan(state));
  }

  const character = snapshot.characters.find(
    (candidate) => candidate.name === goal.characterName,
  );
  if (character === undefined) {
    return err(new GatheringCharacterNotFoundError(goal.characterName));
  }

  const currentLevel = skillLevel(character, goal.skill);
  if (currentLevel >= goal.targetLevel) {
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

  const resource = knowledge.resources.find(
    (candidate) => candidate.code === goal.resourceCode,
  );
  if (resource === undefined) {
    return err(new GatheringResourceNotResolvedError(goal.resourceCode));
  }

  const resourceValidation = validateResource(
    character.name,
    currentLevel,
    goal,
    resource,
  );
  if (resourceValidation.isErr()) {
    return err(resourceValidation.error);
  }

  return ok({
    activities: [
      {
        activity: { resourceCode: resource.code, type: 'farmResource' },
        characterName: character.name,
        consumes: [],
        goalId: goal.id,
        produces: producedItems(resource),
      },
    ],
    state,
  });
};
