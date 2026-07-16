import { describe, expect, it } from 'vitest';

import type {
  ActiveGoal,
  ReachCombatLevelGoal,
} from '../src/bot/orchestration/orchestratorState.js';
import {
  durableStateFrom,
  restoreOrchestratorState,
  type DurableOrchestratorState,
} from '../src/bot/orchestration/orchestratorStateRepository.js';
import { createInMemoryOrchestratorStateRepository } from '../src/persistence/inMemoryOrchestratorStateRepository.js';

type AutonomousCombatGoal = ReachCombatLevelGoal &
  Readonly<{ origin: 'autonomous'; reason: string; rule: 'combatProgression' }>;

const buildGoal = (
  overrides: Partial<AutonomousCombatGoal> = {},
): AutonomousCombatGoal => ({
  characterName: 'Stan',
  id: 'reachCombatLevel:Stan:6',
  origin: 'autonomous',
  reason: 'Progress Stan to the next combat level',
  rule: 'combatProgression',
  targetLevel: 6,
  type: 'reachCombatLevel',
  ...overrides,
});

const buildDurableState = (): DurableOrchestratorState => ({
  goals: [buildGoal()],
});

describe('OrchestratorStateRepository', () => {
  it('starts empty when no initial state is provided', () => {
    const repository = createInMemoryOrchestratorStateRepository();

    expect(repository.load()._unsafeUnwrap()).toBeUndefined();
  });

  it('saves and loads durable Active Goals', () => {
    const repository = createInMemoryOrchestratorStateRepository();
    const state = buildDurableState();

    expect(repository.save(state).isOk()).toBe(true);
    expect(repository.load()._unsafeUnwrap()).toEqual(state);
  });

  it('isolates persisted state from caller mutations', () => {
    const initialGoal = buildGoal();
    const mutableGoals = [initialGoal];
    const repository = createInMemoryOrchestratorStateRepository({
      goals: mutableGoals,
    });

    mutableGoals.push(buildGoal({ id: 'external-mutation' }));
    const firstLoad = repository.load()._unsafeUnwrap();
    const loadedGoals = firstLoad?.goals as ActiveGoal[];
    loadedGoals.push(buildGoal({ id: 'loaded-mutation' }));

    expect(repository.load()._unsafeUnwrap()).toEqual({ goals: [initialGoal] });
  });

  it('keeps repository instances isolated', () => {
    const first = createInMemoryOrchestratorStateRepository();
    const second = createInMemoryOrchestratorStateRepository();

    first.save(buildDurableState());

    expect(first.load()._unsafeUnwrap()).toEqual(buildDurableState());
    expect(second.load()._unsafeUnwrap()).toBeUndefined();
  });
});

describe('orchestrator state persistence boundaries', () => {
  it('excludes Reservations from durable state', () => {
    const goal = buildGoal();

    expect(
      durableStateFrom({
        goals: [goal],
        reservations: [
          {
            activity: { monsterCode: 'yellow_slime', type: 'fightMonster' },
            characterName: 'Stan',
            consumes: [],
            goalId: goal.id,
            produces: [],
          },
        ],
      }),
    ).toEqual({ goals: [goal] });
  });

  it('restores durable Goals with empty Reservations', () => {
    const durableState = buildDurableState();

    expect(restoreOrchestratorState(durableState)).toEqual({
      goals: durableState.goals,
      reservations: [],
    });
  });

  it('restores an empty state when no durable state or fallback exists', () => {
    expect(restoreOrchestratorState(undefined)).toEqual({
      goals: [],
      reservations: [],
    });
  });

  it('uses configured fallback Goals when no durable state exists', () => {
    const fallbackGoals: readonly ActiveGoal[] = [
      {
        characterName: 'Stan',
        id: 'reachCombatLevel:Stan:6',
        origin: 'configured',
        targetLevel: 6,
        type: 'reachCombatLevel',
      },
    ];

    expect(restoreOrchestratorState(undefined, fallbackGoals)).toEqual({
      goals: fallbackGoals,
      reservations: [],
    });
  });
});
