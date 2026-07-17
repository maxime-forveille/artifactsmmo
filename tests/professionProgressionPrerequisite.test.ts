import { describe, expect, it } from 'vitest';

import { InsufficientCraftingLevelError } from '../src/bot/activities/crafting.js';
import {
  createReachProfessionLevelGoalId,
  proposeProfessionProgressionPrerequisite,
} from '../src/bot/orchestration/professionProgressionPrerequisite.js';

describe('createReachProfessionLevelGoalId', () => {
  it('creates a stable semantic id from character, skill, and target', () => {
    expect(createReachProfessionLevelGoalId('Stan', 'weaponcrafting', 5)).toBe(
      'reachProfessionLevel:Stan:weaponcrafting:5',
    );
  });
});

describe('proposeProfessionProgressionPrerequisite', () => {
  it('turns a crafting-level Blocker into a parent prerequisite', () => {
    const error = new InsufficientCraftingLevelError(
      'copper_dagger',
      'weaponcrafting',
      5,
      3,
    );

    expect(
      proposeProfessionProgressionPrerequisite({
        error,
        event: {
          characterName: 'Stan',
          goalId: 'equipItem:Stan:copper_dagger',
          type: 'blocked',
        },
      }),
    ).toEqual([
      {
        configuredRank: -1,
        goal: {
          characterName: 'Stan',
          id: 'reachProfessionLevel:Stan:weaponcrafting:5',
          skill: 'weaponcrafting',
          targetLevel: 5,
          type: 'reachProfessionLevel',
        },
        parentGoalId: 'equipItem:Stan:copper_dagger',
        reason:
          'Stan needs weaponcrafting level 5 to craft copper_dagger; current level is 3',
        rule: 'professionProgression',
      },
    ]);
  });

  it.each([
    undefined,
    {
      error: new InsufficientCraftingLevelError(
        'copper_dagger',
        'weaponcrafting',
        5,
        3,
      ),
      event: {
        characterName: 'Stan',
        goalId: 'equipItem:Stan:copper_dagger',
        type: 'completed' as const,
      },
    },
    {
      error: new Error('another blocker'),
      event: {
        characterName: 'Stan',
        goalId: 'equipItem:Stan:copper_dagger',
        type: 'blocked' as const,
      },
    },
    {
      error: new InsufficientCraftingLevelError(
        'copper_dagger',
        'weaponcrafting',
        5,
        3,
      ),
      event: {
        goalId: 'equipItem:Stan:copper_dagger',
        type: 'blocked' as const,
      },
    },
  ])('ignores outcomes that do not identify this prerequisite', (outcome) => {
    expect(proposeProfessionProgressionPrerequisite(outcome)).toEqual([]);
  });
});
