import { describe, expect, it } from 'vitest';

import type { CrewSnapshot } from '../src/bot/orchestration/crewSnapshot.js';
import {
  createGatheringProgressionGoalRule,
  createReachGatheringLevelGoalId,
  findBestGatheringResource,
} from '../src/bot/orchestration/gatheringProgressionGoalRule.js';
import type { GoalPolicyContext } from '../src/bot/orchestration/goalPolicy.js';
import type { components } from '../src/client/schema.js';

type Character = components['schemas']['CharacterSchema'];
type Resource = components['schemas']['ResourceSchema'];

const buildCharacter = (
  name: string,
  overrides: Partial<Character> = {},
): Character => ({ ...({} as Character), name, ...overrides });

const buildResource = (
  code: string,
  overrides: Partial<Resource> = {},
): Resource => ({
  code,
  drops: [{ code: `${code}_drop`, max_quantity: 1, min_quantity: 1, rate: 1 }],
  level: 1,
  name: code,
  skill: 'mining',
  ...overrides,
});

const buildContext = (
  characters: readonly Character[],
  resources: readonly Resource[],
): GoalPolicyContext => ({
  snapshot: {
    bank: [],
    capturedAt: '2026-07-16T12:00:00.000Z',
    characters,
  } satisfies CrewSnapshot,
  state: { goals: [], reservations: [] },
  world: { items: [], monsters: [], resources },
});

describe('createReachGatheringLevelGoalId', () => {
  it('creates a stable semantic id from character, skill, and target level', () => {
    expect(createReachGatheringLevelGoalId('Stan', 'mining', 6)).toBe(
      'reachGatheringLevel:Stan:mining:6',
    );
  });
});

describe('findBestGatheringResource', () => {
  it('selects the highest-level resource at or below the current level', () => {
    const low = buildResource('copper_rocks', { level: 1 });
    const high = buildResource('iron_rocks', { level: 5 });

    expect(findBestGatheringResource([low, high], 'mining', 5)).toBe(high);
  });

  it('excludes resources above the current level', () => {
    const low = buildResource('copper_rocks', { level: 1 });
    const high = buildResource('iron_rocks', { level: 5 });

    expect(findBestGatheringResource([low, high], 'mining', 3)).toBe(low);
  });

  it('excludes resources for a different skill', () => {
    const mining = buildResource('copper_rocks', { level: 1, skill: 'mining' });
    const woodcutting = buildResource('ash_tree', {
      level: 5,
      skill: 'woodcutting',
    });

    expect(findBestGatheringResource([mining, woodcutting], 'mining', 5)).toBe(
      mining,
    );
  });

  it('breaks equal-level ties by resource code', () => {
    const first = buildResource('bbb_rocks', { level: 3 });
    const second = buildResource('aaa_rocks', { level: 3 });

    expect(findBestGatheringResource([first, second], 'mining', 3)).toBe(
      second,
    );
  });

  it('returns undefined when no resource qualifies', () => {
    expect(findBestGatheringResource([], 'mining', 5)).toBeUndefined();
  });
});

describe('createGatheringProgressionGoalRule', () => {
  it('discovers a next-level Goal with the best eligible resource for each configured target', () => {
    const character = buildCharacter('Stan', { mining_level: 5 });
    const resource = buildResource('iron_rocks', { level: 5 });
    const rule = createGatheringProgressionGoalRule([
      { characterName: 'Stan', skill: 'mining' },
    ]);

    expect(rule(buildContext([character], [resource]))).toEqual([
      {
        goal: {
          characterName: 'Stan',
          id: 'reachGatheringLevel:Stan:mining:6',
          resourceCode: 'iron_rocks',
          skill: 'mining',
          targetLevel: 6,
          type: 'reachGatheringLevel',
        },
        reason:
          'Stan can progress mining from level 5 to 6 by gathering iron_rocks',
        utility: 1,
      },
    ]);
  });

  it('discovers no Goal for an unconfigured character', () => {
    const rule = createGatheringProgressionGoalRule([]);

    expect(
      rule(buildContext([buildCharacter('Stan', { mining_level: 5 })], [])),
    ).toEqual([]);
  });

  it('discovers no Goal for a configured character absent from the Crew Snapshot', () => {
    const rule = createGatheringProgressionGoalRule([
      { characterName: 'Missing', skill: 'mining' },
    ]);

    expect(
      rule(
        buildContext(
          [buildCharacter('Stan', { mining_level: 5 })],
          [buildResource('iron_rocks', { level: 5 })],
        ),
      ),
    ).toEqual([]);
  });

  it('discovers no Goal when no resource is currently eligible', () => {
    const rule = createGatheringProgressionGoalRule([
      { characterName: 'Stan', skill: 'mining' },
    ]);

    expect(
      rule(
        buildContext(
          [buildCharacter('Stan', { mining_level: 0 })],
          [buildResource('iron_rocks', { level: 5 })],
        ),
      ),
    ).toEqual([]);
  });

  it('discovers independent Goals for several configured targets', () => {
    const rule = createGatheringProgressionGoalRule([
      { characterName: 'Stan', skill: 'mining' },
      { characterName: 'Kyle', skill: 'woodcutting' },
    ]);
    const context = buildContext(
      [
        buildCharacter('Stan', { mining_level: 5 }),
        buildCharacter('Kyle', { woodcutting_level: 2 }),
      ],
      [
        buildResource('iron_rocks', { level: 5, skill: 'mining' }),
        buildResource('ash_tree', { level: 2, skill: 'woodcutting' }),
      ],
    );

    expect(
      rule(context).map((candidate) =>
        candidate.goal.type === 'reachGatheringLevel'
          ? candidate.goal.characterName
          : undefined,
      ),
    ).toEqual(['Stan', 'Kyle']);
  });

  it('defaults to no candidates when no targets are configured', () => {
    const rule = createGatheringProgressionGoalRule();

    expect(
      rule(buildContext([buildCharacter('Stan', { mining_level: 5 })], [])),
    ).toEqual([]);
  });
});
