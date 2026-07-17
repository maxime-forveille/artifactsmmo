import { InsufficientCraftingLevelError } from '../activities/crafting.js';

import type { PreviousActivityOutcome } from './equipmentProgression.js';
import type { GoalProposal } from './goalPolicy.js';
import type { ReachProfessionLevelGoal } from './orchestratorState.js';

export const createReachProfessionLevelGoalId = (
  characterName: string,
  skill: ReachProfessionLevelGoal['skill'],
  targetLevel: number,
): string => `reachProfessionLevel:${characterName}:${skill}:${targetLevel}`;

const createReachProfessionLevelGoal = (
  characterName: string,
  skill: ReachProfessionLevelGoal['skill'],
  targetLevel: number,
): ReachProfessionLevelGoal => ({
  characterName,
  id: createReachProfessionLevelGoalId(characterName, skill, targetLevel),
  skill,
  targetLevel,
  type: 'reachProfessionLevel',
});

/** Converts a crafting-level Blocker into one finite parent prerequisite. */
export const proposeProfessionProgressionPrerequisite = (
  outcome: PreviousActivityOutcome | undefined,
): readonly GoalProposal[] => {
  if (
    outcome === undefined ||
    !('error' in outcome) ||
    outcome.event.type !== 'blocked' ||
    outcome.event.characterName === undefined ||
    !(outcome.error instanceof InsufficientCraftingLevelError)
  ) {
    return [];
  }

  const { characterName, goalId } = outcome.event;
  const { currentLevel, itemCode, requiredLevel, skill } = outcome.error;

  return [
    {
      configuredRank: -1,
      goal: createReachProfessionLevelGoal(characterName, skill, requiredLevel),
      parentGoalId: goalId,
      reason: `${characterName} needs ${skill} level ${requiredLevel} to craft ${itemCode}; current level is ${currentLevel}`,
      rule: 'professionProgression',
    },
  ];
};
