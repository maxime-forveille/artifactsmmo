import { err, ok, type Result } from 'neverthrow';

import { craftSkillLevel } from '../progression.js';

import type { CrewSnapshot } from './crewSnapshot.js';
import type {
  ActivityAssignment,
  OrchestratorState,
} from './orchestratorState.js';

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

const unchangedPlan = (
  state: OrchestratorState,
): ProfessionProgressionPlan => ({ activities: [], state });

/** Reconciles one profession-level Goal before XP crafts are planned. */
export const planProfessionProgression = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
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

  if (craftSkillLevel(character, goal.skill) < goal.targetLevel) {
    return ok(unchangedPlan(state));
  }

  return ok({
    activities: [],
    state: {
      goals: state.goals.filter((candidate) => candidate.id !== goal.id),
      reservations: state.reservations,
    },
  });
};
