import { describe, expect, it } from 'vitest';

import type { CrewSnapshot } from '../src/bot/orchestration/crewSnapshot.js';
import {
  InvalidProduceItemTargetError,
  NoEligibleProducerError,
  planItemProduction,
  ProduceItemTargetMismatchError,
} from '../src/bot/orchestration/itemProduction.js';
import type {
  ActiveGoal,
  OrchestratorState,
  ProduceItemGoal,
} from '../src/bot/orchestration/orchestratorState.js';
import type { components } from '../src/client/schema.js';

type Character = components['schemas']['CharacterSchema'];
type Item = components['schemas']['ItemSchema'];

const buildCharacter = (
  name: string,
  overrides: Partial<Character> = {},
): Character => ({
  ...({} as Character),
  gearcrafting_level: 5,
  inventory: [],
  name,
  ...overrides,
});

const buildItem = (overrides: Partial<Item> = {}): Item => ({
  ...({} as Item),
  code: 'copper_bar',
  craft: {
    items: [{ code: 'copper_ore', quantity: 2 }],
    level: 5,
    quantity: 1,
    skill: 'gearcrafting',
  },
  ...overrides,
});

const productionGoal: ActiveGoal & ProduceItemGoal = {
  id: 'produceItem:copper_bar:4',
  itemCode: 'copper_bar',
  minimumBankQuantity: 4,
  origin: 'prerequisite',
  parentGoalId: 'reachProfessionLevel:Stan:gearcrafting:6',
  reason: 'Craft an intermediate for the parent Goal',
  rule: 'professionProgression',
  type: 'produceItem',
};

const buildSnapshot = (
  characters: readonly Character[],
  bank: CrewSnapshot['bank'] = [],
): CrewSnapshot => ({
  bank,
  capturedAt: '2026-07-17T12:00:00.000Z',
  characters,
});

const buildState = (
  overrides: Partial<OrchestratorState> = {},
): OrchestratorState => ({
  goals: [productionGoal],
  reservations: [],
  ...overrides,
});

describe('planItemProduction', () => {
  it('ignores an empty Goal list', () => {
    const state = buildState({ goals: [] });

    expect(
      planItemProduction(
        buildSnapshot([buildCharacter('Stan')]),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('ignores a different leading Goal type', () => {
    const otherGoal: ActiveGoal = {
      characterName: 'Stan',
      id: 'equipItem:Stan:copper_dagger',
      itemCode: 'copper_dagger',
      origin: 'autonomous',
      reason: 'Improve combat equipment',
      rule: 'equipmentUpgrade',
      type: 'equipItem',
    };
    const state = buildState({ goals: [otherGoal] });

    expect(
      planItemProduction(
        buildSnapshot([buildCharacter('Stan')]),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('returns a typed error when the resolved item does not match the Goal', () => {
    const result = planItemProduction(
      buildSnapshot([buildCharacter('Stan')]),
      buildState(),
      buildItem({ code: 'different_item' }),
    );

    expect(result._unsafeUnwrapErr()).toEqual(
      new ProduceItemTargetMismatchError('different_item', 'copper_bar'),
    );
  });

  it.each([
    {
      item: { ...({} as Item), code: 'copper_bar' },
      name: 'no craft definition at all',
    },
    {
      item: {
        ...({} as Item),
        code: 'copper_bar',
        craft: { level: 5, quantity: 1, skill: 'gearcrafting' as const },
      },
      name: 'a craft skill but no material list',
    },
    {
      item: {
        ...({} as Item),
        code: 'copper_bar',
        craft: {
          items: [],
          level: 5,
          quantity: 1,
          skill: 'gearcrafting' as const,
        },
      },
      name: 'an empty material list',
    },
  ])('returns a typed error when the resolved item has $name', ({ item }) => {
    const result = planItemProduction(
      buildSnapshot([buildCharacter('Stan')]),
      buildState(),
      item,
    );

    expect(result._unsafeUnwrapErr()).toEqual(
      new InvalidProduceItemTargetError('copper_bar'),
    );
  });

  it('completes only the matching Goal once unreserved bank stock reaches the target', () => {
    const otherGoal: ActiveGoal = {
      characterName: 'Stan',
      id: 'equipItem:Stan:copper_dagger',
      itemCode: 'copper_dagger',
      origin: 'autonomous',
      reason: 'Improve combat equipment',
      rule: 'equipmentUpgrade',
      type: 'equipItem',
    };
    const state = buildState({ goals: [productionGoal, otherGoal] });

    expect(
      planItemProduction(
        buildSnapshot(
          [buildCharacter('Stan')],
          [{ code: 'copper_bar', quantity: 4 }],
        ),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({
      activities: [],
      state: { goals: [otherGoal], reservations: [] },
    });
  });

  it('excludes bank stock already reserved by another withdrawal', () => {
    const producer = buildCharacter('Stan', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const state = buildState({
      reservations: [
        {
          activity: {
            itemCode: 'copper_bar',
            quantity: 4,
            type: 'withdrawItem',
          },
          characterName: 'Kyle',
          consumes: [{ itemCode: 'copper_bar', quantity: 4 }],
          goalId: 'another-goal',
          produces: [],
        },
      ],
    });

    expect(
      planItemProduction(
        buildSnapshot([producer], [{ code: 'copper_bar', quantity: 4 }]),
        state,
        buildItem(),
      )._unsafeUnwrap().activities[0]?.activity,
    ).toEqual({ itemCode: 'copper_bar', quantity: 4, type: 'craftItem' });
  });

  it('waits while the Goal already has a Reservation on a different character', () => {
    const kyle = buildCharacter('Kyle', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const state = buildState({
      reservations: [
        {
          activity: {
            itemCode: 'copper_ore',
            quantity: 2,
            type: 'withdrawItem',
          },
          characterName: 'Stan',
          consumes: [{ itemCode: 'copper_ore', quantity: 2 }],
          goalId: productionGoal.id,
          produces: [],
        },
      ],
    });

    expect(
      planItemProduction(
        buildSnapshot([kyle]),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('returns a typed error when no character has the required crafting level', () => {
    const result = planItemProduction(
      buildSnapshot([buildCharacter('Stan', { gearcrafting_level: 1 })]),
      buildState(),
      buildItem(),
    );

    expect(result._unsafeUnwrapErr()).toEqual(
      new NoEligibleProducerError('copper_bar', 'gearcrafting', 5),
    );
  });

  it('deposits crafted stock already held by an idle character', () => {
    const holder = buildCharacter('Stan', {
      inventory: [{ code: 'copper_bar', quantity: 3, slot: 0 }],
    });

    expect(
      planItemProduction(
        buildSnapshot([holder]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({
      activities: [
        {
          activity: {
            itemCode: 'copper_bar',
            quantity: 3,
            type: 'depositItem',
          },
          characterName: 'Stan',
          consumes: [],
          goalId: productionGoal.id,
          produces: [{ itemCode: 'copper_bar', quantity: 3 }],
        },
      ],
      state: buildState(),
    });
  });

  it('caps the deposit to the quantity still needed', () => {
    const holder = buildCharacter('Stan', {
      inventory: [{ code: 'copper_bar', quantity: 10, slot: 0 }],
    });

    expect(
      planItemProduction(
        buildSnapshot([holder], [{ code: 'copper_bar', quantity: 1 }]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap().activities[0]?.activity,
    ).toEqual({ itemCode: 'copper_bar', quantity: 3, type: 'depositItem' });
  });

  it('waits while the only holder of the crafted item is reserved', () => {
    const holder = buildCharacter('Stan', {
      inventory: [{ code: 'copper_bar', quantity: 3, slot: 0 }],
    });
    const state = buildState({
      reservations: [
        {
          activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
          characterName: 'Stan',
          consumes: [],
          goalId: 'another-goal',
          produces: [],
        },
      ],
    });

    expect(
      planItemProduction(
        buildSnapshot([holder]),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('waits instead of double-producing while a busy character already holds stock', () => {
    const busyHolder = buildCharacter('Kyle', {
      inventory: [{ code: 'copper_bar', quantity: 3, slot: 0 }],
    });
    const idleProducer = buildCharacter('Stan', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const state = buildState({
      reservations: [
        {
          activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
          characterName: 'Kyle',
          consumes: [],
          goalId: 'another-goal',
          produces: [],
        },
      ],
    });

    expect(
      planItemProduction(
        buildSnapshot([busyHolder, idleProducer]),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('withdraws one missing material before crafting', () => {
    const producer = buildCharacter('Stan');

    expect(
      planItemProduction(
        buildSnapshot([producer], [{ code: 'copper_ore', quantity: 8 }]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({
      activities: [
        {
          activity: {
            itemCode: 'copper_ore',
            quantity: 8,
            type: 'withdrawItem',
          },
          characterName: 'Stan',
          consumes: [{ itemCode: 'copper_ore', quantity: 8 }],
          goalId: productionGoal.id,
          produces: [],
        },
      ],
      state: buildState(),
    });
  });

  it('waits when a missing material is not available from the bank', () => {
    const producer = buildCharacter('Stan');
    const state = buildState();

    expect(
      planItemProduction(
        buildSnapshot([producer]),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('crafts the batch size required to reach the target once materials are held', () => {
    const producer = buildCharacter('Stan', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });

    expect(
      planItemProduction(
        buildSnapshot([producer]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({
      activities: [
        {
          activity: { itemCode: 'copper_bar', quantity: 4, type: 'craftItem' },
          characterName: 'Stan',
          consumes: [{ itemCode: 'copper_ore', quantity: 8 }],
          goalId: productionGoal.id,
          produces: [{ itemCode: 'copper_bar', quantity: 4 }],
        },
      ],
      state: buildState(),
    });
  });

  it('prefers the producer already holding the most required material', () => {
    const wellStocked = buildCharacter('Kyle', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const emptyHanded = buildCharacter('Stan');

    expect(
      planItemProduction(
        buildSnapshot([emptyHanded, wellStocked]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap().activities[0]?.characterName,
    ).toBe('Kyle');
  });

  it('prefers coverage over alphabetical order when they disagree', () => {
    const wellStocked = buildCharacter('Zeb', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const emptyHanded = buildCharacter('Amy');

    expect(
      planItemProduction(
        buildSnapshot([emptyHanded, wellStocked]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap().activities[0]?.characterName,
    ).toBe('Zeb');
  });

  it('caps coverage at the quantity a recipe actually needs', () => {
    const item = buildItem({
      craft: {
        items: [
          { code: 'copper_ore', quantity: 2 },
          { code: 'coal', quantity: 2 },
        ],
        level: 5,
        quantity: 1,
        skill: 'gearcrafting',
      },
    });
    const excessHolder = buildCharacter('Amy', {
      inventory: [{ code: 'copper_ore', quantity: 100, slot: 0 }],
    });
    const exactHolder = buildCharacter('Zeb', {
      inventory: [
        { code: 'coal', quantity: 8, slot: 0 },
        { code: 'copper_ore', quantity: 8, slot: 1 },
      ],
    });

    expect(
      planItemProduction(
        buildSnapshot([excessHolder, exactHolder]),
        buildState(),
        item,
      )._unsafeUnwrap().activities[0],
    ).toMatchObject({ characterName: 'Zeb' });
  });

  it('breaks a coverage tie by character name', () => {
    const kyle = buildCharacter('Kyle');
    const stan = buildCharacter('Stan');

    expect(
      planItemProduction(
        buildSnapshot([kyle, stan], [{ code: 'copper_ore', quantity: 8 }]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap().activities[0]?.characterName,
    ).toBe('Kyle');
  });

  it('overrides the earlier best with a tied producer earlier in alphabetical order', () => {
    const stan = buildCharacter('Stan');
    const amy = buildCharacter('Amy');

    expect(
      planItemProduction(
        buildSnapshot([stan, amy], [{ code: 'copper_ore', quantity: 8 }]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap().activities[0]?.characterName,
    ).toBe('Amy');
  });

  it('keeps the earlier best producer when a later character has less coverage', () => {
    const wellStocked = buildCharacter('Zeb', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const emptyHanded = buildCharacter('Amy');

    expect(
      planItemProduction(
        buildSnapshot([wellStocked, emptyHanded]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap().activities[0]?.characterName,
    ).toBe('Zeb');
  });

  it('skips a reserved eligible producer for a lower-priority idle one', () => {
    const reservedProducer = buildCharacter('Kyle', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const idleProducer = buildCharacter('Stan', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const state = buildState({
      reservations: [
        {
          activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
          characterName: 'Kyle',
          consumes: [],
          goalId: 'another-goal',
          produces: [],
        },
      ],
    });

    expect(
      planItemProduction(
        buildSnapshot([reservedProducer, idleProducer]),
        state,
        buildItem(),
      )._unsafeUnwrap().activities[0]?.characterName,
    ).toBe('Stan');
  });

  it('waits when every eligible producer is already reserved', () => {
    const producer = buildCharacter('Stan', {
      inventory: [{ code: 'copper_ore', quantity: 8, slot: 0 }],
    });
    const state = buildState({
      reservations: [
        {
          activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
          characterName: 'Stan',
          consumes: [],
          goalId: 'another-goal',
          produces: [],
        },
      ],
    });

    expect(
      planItemProduction(
        buildSnapshot([producer]),
        state,
        buildItem(),
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('crafts several batches when more than one recipe run is needed', () => {
    const producer = buildCharacter('Stan', {
      inventory: [{ code: 'copper_ore', quantity: 20, slot: 0 }],
    });
    const item = buildItem({
      craft: {
        items: [{ code: 'copper_ore', quantity: 2 }],
        level: 5,
        quantity: 3,
        skill: 'gearcrafting',
      },
    });

    expect(
      planItemProduction(
        buildSnapshot([producer]),
        buildState(),
        item,
      )._unsafeUnwrap().activities[0],
    ).toMatchObject({
      activity: { itemCode: 'copper_bar', quantity: 2, type: 'craftItem' },
      consumes: [{ itemCode: 'copper_ore', quantity: 4 }],
      produces: [{ itemCode: 'copper_bar', quantity: 6 }],
    });
  });

  it('subtracts already-banked stock before sizing the craft batch', () => {
    const producer = buildCharacter('Stan', {
      inventory: [{ code: 'copper_ore', quantity: 20, slot: 0 }],
    });

    expect(
      planItemProduction(
        buildSnapshot([producer], [{ code: 'copper_bar', quantity: 1 }]),
        buildState(),
        buildItem(),
      )._unsafeUnwrap().activities[0],
    ).toMatchObject({
      activity: { itemCode: 'copper_bar', quantity: 3, type: 'craftItem' },
      consumes: [{ itemCode: 'copper_ore', quantity: 6 }],
      produces: [{ itemCode: 'copper_bar', quantity: 3 }],
    });
  });
});
