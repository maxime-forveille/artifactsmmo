import { describe, expect, it } from 'vitest';

import type { CrewSnapshot } from '../src/bot/orchestration/crewSnapshot.js';
import {
  GatheringCharacterNotFoundError,
  GatheringResourceNotResolvedError,
  InvalidGatheringResourceTargetError,
  planGatheringProgression,
} from '../src/bot/orchestration/gatheringProgression.js';
import type {
  ActiveGoal,
  OrchestratorState,
  ReachGatheringLevelGoal,
  Reservation,
} from '../src/bot/orchestration/orchestratorState.js';
import type { WorldKnowledge } from '../src/bot/orchestration/worldKnowledge.js';
import type { components } from '../src/client/schema.js';

type Character = components['schemas']['CharacterSchema'];
type Resource = components['schemas']['ResourceSchema'];

const buildCharacter = (
  name: string,
  overrides: Partial<Character> = {},
): Character => ({ ...({} as Character), name, ...overrides });

const buildGoal = (
  overrides: Partial<ReachGatheringLevelGoal> = {},
): ActiveGoal & ReachGatheringLevelGoal => ({
  characterName: 'Stan',
  id: 'reachGatheringLevel:Stan:mining:6',
  origin: 'autonomous',
  reason: 'Stan can progress mining from level 5 to 6 by gathering iron_rocks',
  resourceCode: 'iron_rocks',
  rule: 'gatheringProgression',
  skill: 'mining',
  targetLevel: 6,
  type: 'reachGatheringLevel',
  ...overrides,
});

const buildResource = (overrides: Partial<Resource> = {}): Resource => ({
  code: 'iron_rocks',
  drops: [{ code: 'iron_ore', max_quantity: 1, min_quantity: 1, rate: 1 }],
  level: 5,
  name: 'Iron Rocks',
  skill: 'mining',
  ...overrides,
});

const buildSnapshot = (
  overrides: Partial<CrewSnapshot> = {},
): CrewSnapshot => ({
  bank: [],
  capturedAt: '2026-07-16T12:00:00.000Z',
  characters: [buildCharacter('Stan', { mining_level: 5 })],
  ...overrides,
});

const buildState = (
  overrides: Partial<OrchestratorState> = {},
): OrchestratorState => ({
  goals: [buildGoal()],
  reservations: [],
  ...overrides,
});

const buildKnowledge = (
  resources: readonly Resource[] = [buildResource()],
): Pick<WorldKnowledge, 'resources'> => ({ resources });

const buildReservation = (
  overrides: Partial<Reservation> = {},
): Reservation => ({
  activity: { resourceCode: 'iron_rocks', type: 'farmResource' },
  characterName: 'Stan',
  consumes: [],
  goalId: 'other-goal',
  produces: [],
  ...overrides,
});

describe('planGatheringProgression', () => {
  it('proposes a farmResource Activity for the Goal resource and character', () => {
    const result = planGatheringProgression(
      buildSnapshot(),
      buildState(),
      buildKnowledge(),
    );

    expect(result._unsafeUnwrap()).toEqual({
      activities: [
        {
          activity: { resourceCode: 'iron_rocks', type: 'farmResource' },
          characterName: 'Stan',
          consumes: [],
          goalId: 'reachGatheringLevel:Stan:mining:6',
          produces: [{ itemCode: 'iron_ore' }],
        },
      ],
      state: buildState(),
    });
  });

  it('deduplicates produced item codes from resource drops', () => {
    const resource = buildResource({
      drops: [
        { code: 'iron_ore', max_quantity: 1, min_quantity: 1, rate: 1 },
        { code: 'iron_ore', max_quantity: 2, min_quantity: 1, rate: 0.1 },
      ],
    });

    const result = planGatheringProgression(
      buildSnapshot(),
      buildState(),
      buildKnowledge([resource]),
    );

    expect(result._unsafeUnwrap().activities[0]?.produces).toEqual([
      { itemCode: 'iron_ore' },
    ]);
  });

  it('completes the Goal once the observed skill level reaches the target', () => {
    const otherGoal = buildGoal({
      characterName: 'Kyle',
      id: 'reachGatheringLevel:Kyle:woodcutting:6',
      skill: 'woodcutting',
    });
    const state = buildState({ goals: [buildGoal(), otherGoal] });

    const result = planGatheringProgression(
      buildSnapshot({
        characters: [buildCharacter('Stan', { mining_level: 6 })],
      }),
      state,
      buildKnowledge(),
    );

    expect(result._unsafeUnwrap()).toEqual({
      activities: [],
      state: { goals: [otherGoal], reservations: [] },
    });
  });

  it('waits when the character already has a Reservation', () => {
    const state = buildState({ reservations: [buildReservation()] });

    const result = planGatheringProgression(
      buildSnapshot(),
      state,
      buildKnowledge(),
    );

    expect(result._unsafeUnwrap()).toEqual({ activities: [], state });
  });

  it('waits when the Goal already has a Reservation', () => {
    const state = buildState({
      reservations: [
        buildReservation({
          characterName: 'Someone Else',
          goalId: 'reachGatheringLevel:Stan:mining:6',
        }),
      ],
    });

    const result = planGatheringProgression(
      buildSnapshot(),
      state,
      buildKnowledge(),
    );

    expect(result._unsafeUnwrap()).toEqual({ activities: [], state });
  });

  it('proceeds when a Reservation matches neither the character nor the Goal', () => {
    const state = buildState({
      reservations: [
        buildReservation({
          characterName: 'Someone Else',
          goalId: 'other-goal',
        }),
      ],
    });

    const result = planGatheringProgression(
      buildSnapshot(),
      state,
      buildKnowledge(),
    );

    expect(result._unsafeUnwrap().activities).toEqual([
      {
        activity: { resourceCode: 'iron_rocks', type: 'farmResource' },
        characterName: 'Stan',
        consumes: [],
        goalId: 'reachGatheringLevel:Stan:mining:6',
        produces: [{ itemCode: 'iron_ore' }],
      },
    ]);
  });

  it('returns unchanged state for a Goal of a different type', () => {
    const state = buildState({
      goals: [
        {
          characterName: 'Stan',
          id: 'reachCombatLevel:Stan:6',
          origin: 'configured',
          targetLevel: 6,
          type: 'reachCombatLevel',
        },
      ],
    });

    const result = planGatheringProgression(
      buildSnapshot(),
      state,
      buildKnowledge(),
    );

    expect(result._unsafeUnwrap()).toEqual({ activities: [], state });
  });

  it('returns unchanged state for an empty Goal list', () => {
    const state = buildState({ goals: [] });

    const result = planGatheringProgression(
      buildSnapshot(),
      state,
      buildKnowledge(),
    );

    expect(result._unsafeUnwrap()).toEqual({ activities: [], state });
  });

  it('fails when the Goal character does not exist in the Crew Snapshot', () => {
    const result = planGatheringProgression(
      buildSnapshot({
        characters: [buildCharacter('Kyle', { mining_level: 5 })],
      }),
      buildState(),
      buildKnowledge(),
    );

    const error = result._unsafeUnwrapErr();
    expect(error).toEqual(new GatheringCharacterNotFoundError('Stan'));
    expect(error).toMatchObject({
      characterName: 'Stan',
      message: 'Character "Stan" does not exist in the Crew Snapshot',
      name: 'GatheringCharacterNotFoundError',
    });
  });

  it('fails when the persisted resource code no longer exists', () => {
    const result = planGatheringProgression(
      buildSnapshot(),
      buildState(),
      buildKnowledge([buildResource({ code: 'copper_rocks' })]),
    );

    const error = result._unsafeUnwrapErr();
    expect(error).toEqual(new GatheringResourceNotResolvedError('iron_rocks'));
    expect(error).toMatchObject({
      message: 'Resource "iron_rocks" does not exist in World Knowledge',
      name: 'GatheringResourceNotResolvedError',
      resourceCode: 'iron_rocks',
    });
  });

  it('fails when the persisted resource no longer matches the Goal skill', () => {
    const mismatchedResource = buildResource({ skill: 'woodcutting' });

    const result = planGatheringProgression(
      buildSnapshot(),
      buildState(),
      buildKnowledge([mismatchedResource]),
    );

    const error = result._unsafeUnwrapErr();
    expect(error).toEqual(
      new InvalidGatheringResourceTargetError('iron_rocks does not use mining'),
    );
    expect(error).toMatchObject({
      message: 'iron_rocks does not use mining',
      name: 'InvalidGatheringResourceTargetError',
    });
  });

  it('fails when the persisted resource is now above the observed skill level', () => {
    const result = planGatheringProgression(
      buildSnapshot({
        characters: [buildCharacter('Stan', { mining_level: 2 })],
      }),
      buildState(),
      buildKnowledge(),
    );

    const error = result._unsafeUnwrapErr();
    expect(error).toEqual(
      new InvalidGatheringResourceTargetError(
        'Stan has mining level 2, but iron_rocks requires 5',
      ),
    );
    expect(error).toMatchObject({
      message: 'Stan has mining level 2, but iron_rocks requires 5',
      name: 'InvalidGatheringResourceTargetError',
    });
  });

  it('selects the resource matching the persisted code among several candidates', () => {
    const other = buildResource({
      code: 'copper_rocks',
      drops: [
        { code: 'copper_ore', max_quantity: 1, min_quantity: 1, rate: 1 },
      ],
      level: 1,
    });
    const target = buildResource();

    const result = planGatheringProgression(
      buildSnapshot(),
      buildState(),
      buildKnowledge([other, target]),
    );

    expect(result._unsafeUnwrap().activities).toEqual([
      {
        activity: { resourceCode: 'iron_rocks', type: 'farmResource' },
        characterName: 'Stan',
        consumes: [],
        goalId: 'reachGatheringLevel:Stan:mining:6',
        produces: [{ itemCode: 'iron_ore' }],
      },
    ]);
  });
});
