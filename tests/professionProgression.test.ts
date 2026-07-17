import { describe, expect, it } from 'vitest';

import type { CrewSnapshot } from '../src/bot/orchestration/crewSnapshot.js';
import type {
  ActiveGoal,
  OrchestratorState,
} from '../src/bot/orchestration/orchestratorState.js';
import {
  planProfessionProgression,
  ProfessionCharacterNotFoundError,
} from '../src/bot/orchestration/professionProgression.js';
import type { components } from '../src/client/schema.js';

type Character = components['schemas']['CharacterSchema'];

const buildCharacter = (
  weaponcraftingLevel: number,
  name = 'Stan',
): Character => ({
  ...({} as Character),
  name,
  weaponcrafting_level: weaponcraftingLevel,
});

const parentGoal: ActiveGoal = {
  characterName: 'Stan',
  id: 'equipItem:Stan:copper_dagger',
  itemCode: 'copper_dagger',
  origin: 'autonomous',
  reason: 'Improve combat equipment',
  rule: 'equipmentUpgrade',
  type: 'equipItem',
};

const professionGoal: ActiveGoal = {
  characterName: 'Stan',
  id: 'reachProfessionLevel:Stan:weaponcrafting:5',
  origin: 'prerequisite',
  parentGoalId: parentGoal.id,
  reason: 'Reach the crafting level required by the parent',
  rule: 'professionProgression',
  skill: 'weaponcrafting',
  targetLevel: 5,
  type: 'reachProfessionLevel',
};

const buildSnapshot = (characters: readonly Character[]): CrewSnapshot => ({
  bank: [],
  capturedAt: '2026-07-17T12:00:00.000Z',
  characters,
});

const buildState = (
  overrides: Partial<OrchestratorState> = {},
): OrchestratorState => ({
  goals: [professionGoal, parentGoal],
  reservations: [],
  ...overrides,
});

describe('planProfessionProgression', () => {
  it('ignores an empty Goal list', () => {
    const state = buildState({ goals: [] });

    expect(
      planProfessionProgression(
        buildSnapshot([buildCharacter(3)]),
        state,
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('ignores a different leading Goal type', () => {
    const state = buildState({ goals: [parentGoal] });

    expect(
      planProfessionProgression(
        buildSnapshot([buildCharacter(3)]),
        state,
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('returns a typed error when the selected character is absent', () => {
    const result = planProfessionProgression(
      buildSnapshot([buildCharacter(5, 'Kyle')]),
      buildState(),
    );

    const error = result._unsafeUnwrapErr();
    expect(error).toEqual(new ProfessionCharacterNotFoundError('Stan'));
    expect(error.name).toBe('ProfessionCharacterNotFoundError');
    expect(error.message).toBe(
      'Character "Stan" does not exist in the Crew Snapshot',
    );
  });

  it('keeps the finite Goal while the profession level is below its target', () => {
    const state = buildState();

    expect(
      planProfessionProgression(
        buildSnapshot([buildCharacter(4)]),
        state,
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('completes the prerequisite at its observed target level', () => {
    const reservation = {
      activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
      characterName: 'Kyle',
      consumes: [],
      goalId: 'combat-kyle',
      produces: [],
    };
    const state = buildState({ reservations: [reservation] });

    expect(
      planProfessionProgression(
        buildSnapshot([buildCharacter(5)]),
        state,
      )._unsafeUnwrap(),
    ).toEqual({
      activities: [],
      state: { goals: [parentGoal], reservations: [reservation] },
    });
  });
});
