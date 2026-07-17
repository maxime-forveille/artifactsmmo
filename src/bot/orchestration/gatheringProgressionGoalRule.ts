import { skillLevel } from '../progression.js';

import type { GatheringProgressionTarget, GoalRule } from './goalPolicy.js';
import type { ReachGatheringLevelGoal } from './orchestratorState.js';
import type { WorldKnowledge } from './worldKnowledge.js';

type Resource = WorldKnowledge['resources'][number];

export const createReachGatheringLevelGoalId = (
  characterName: string,
  skill: ReachGatheringLevelGoal['skill'],
  targetLevel: number,
): string => `reachGatheringLevel:${characterName}:${skill}:${targetLevel}`;

const createReachGatheringLevelGoal = (
  characterName: string,
  resourceCode: string,
  skill: ReachGatheringLevelGoal['skill'],
  targetLevel: number,
): ReachGatheringLevelGoal => ({
  characterName,
  id: createReachGatheringLevelGoalId(characterName, skill, targetLevel),
  resourceCode,
  skill,
  targetLevel,
  type: 'reachGatheringLevel',
});

/** Selects the highest eligible resource, with its code as a stable tie-breaker. */
export const findBestGatheringResource = (
  resources: readonly Resource[],
  skill: ReachGatheringLevelGoal['skill'],
  currentLevel: number,
): Resource | undefined =>
  resources
    .filter(
      (resource) => resource.skill === skill && resource.level <= currentLevel,
    )
    .toSorted(
      (left, right) =>
        right.level - left.level || left.code.localeCompare(right.code),
    )[0];

/**
 * Builds a configured gathering Goal Rule. The strategy selects each
 * character's gathering skill; the rule selects only the best eligible resource
 * for it.
 */
export const createGatheringProgressionGoalRule =
  (targets: readonly GatheringProgressionTarget[] = []): GoalRule =>
  ({ snapshot, world }) =>
    targets.flatMap(({ characterName, skill }) => {
      const character = snapshot.characters.find(
        (candidate) => candidate.name === characterName,
      );
      if (character === undefined) {
        return [];
      }

      const currentLevel = skillLevel(character, skill);
      const resource = findBestGatheringResource(
        world.resources,
        skill,
        currentLevel,
      );
      if (resource === undefined) {
        return [];
      }

      const targetLevel = currentLevel + 1;

      return [
        {
          goal: createReachGatheringLevelGoal(
            character.name,
            resource.code,
            skill,
            targetLevel,
          ),
          reason: `${character.name} can progress ${skill} from level ${currentLevel} to ${targetLevel} by gathering ${resource.code}`,
          utility: 1,
        },
      ];
    });
