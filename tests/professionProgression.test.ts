import { describe, expect, it } from 'vitest';

import type { CrewSnapshot } from '../src/bot/orchestration/crewSnapshot.js';
import type {
  ActiveGoal,
  OrchestratorState,
} from '../src/bot/orchestration/orchestratorState.js';
import {
  findBestProfessionRecipe,
  planProfessionProgression,
  ProfessionCharacterNotFoundError,
} from '../src/bot/orchestration/professionProgression.js';
import type { components } from '../src/client/schema.js';

type Character = components['schemas']['CharacterSchema'];
type Item = components['schemas']['ItemSchema'];

const buildCharacter = (
  weaponcraftingLevel: number,
  overrides: Partial<Character> = {},
): Character => ({
  ...({} as Character),
  inventory: [],
  inventory_max_items: 20,
  name: 'Stan',
  weaponcrafting_level: weaponcraftingLevel,
  ...overrides,
});

const buildRecipe = (overrides: Partial<Item> = {}): Item => ({
  ...({} as Item),
  code: 'training_blade',
  craft: {
    items: [{ code: 'copper_bar', quantity: 1 }],
    level: 1,
    quantity: 1,
    skill: 'weaponcrafting',
  },
  level: 1,
  type: 'weapon',
  ...overrides,
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

const buildSnapshot = (
  characters: readonly Character[],
  bank: CrewSnapshot['bank'] = [],
): CrewSnapshot => ({
  bank,
  capturedAt: '2026-07-17T12:00:00.000Z',
  characters,
});

const emptyKnowledge = { items: [] } as const;

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
        emptyKnowledge,
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('ignores a different leading Goal type', () => {
    const state = buildState({ goals: [parentGoal] });

    expect(
      planProfessionProgression(
        buildSnapshot([buildCharacter(3)]),
        state,
        emptyKnowledge,
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('returns a typed error when the selected character is absent', () => {
    const result = planProfessionProgression(
      buildSnapshot([buildCharacter(5, { name: 'Kyle' })]),
      buildState(),
      emptyKnowledge,
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
        emptyKnowledge,
      )._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('selects the highest-level held-material recipe with a stable code tie-breaker', () => {
    const character = buildCharacter(4, {
      inventory: [{ code: 'copper_bar', quantity: 1, slot: 0 }],
    });
    const lowRecipe = buildRecipe({ code: 'low_recipe' });
    const zHighRecipe = buildRecipe({
      code: 'z_high_recipe',
      craft: {
        items: [{ code: 'copper_bar', quantity: 1 }],
        level: 4,
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });
    const aHighRecipe = buildRecipe({
      code: 'a_high_recipe',
      craft: {
        items: [{ code: 'copper_bar', quantity: 1 }],
        level: 4,
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });

    expect(
      findBestProfessionRecipe(
        buildSnapshot([character]),
        buildState(),
        character,
        professionGoal,
        { items: [lowRecipe, zHighRecipe, aHighRecipe] },
      ),
    ).toEqual({ item: aHighRecipe, missingMaterials: [], recipeLevel: 4 });
  });

  it('prefers a recipe already held over a higher recipe needing withdrawal', () => {
    const character = buildCharacter(4, {
      inventory: [{ code: 'ash_plank', quantity: 1, slot: 0 }],
    });
    const heldRecipe = buildRecipe({
      code: 'held_recipe',
      craft: {
        items: [{ code: 'ash_plank', quantity: 1 }],
        level: 1,
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });
    const bankRecipe = buildRecipe({
      code: 'bank_recipe',
      craft: {
        items: [{ code: 'copper_bar', quantity: 1 }],
        level: 4,
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });
    const snapshot = buildSnapshot(
      [character],
      [{ code: 'copper_bar', quantity: 1 }],
    );

    expect(
      findBestProfessionRecipe(
        snapshot,
        buildState(),
        character,
        professionGoal,
        { items: [bankRecipe, heldRecipe] },
      )?.item,
    ).toEqual(heldRecipe);
  });

  it('rejects recipes for another skill, above the current level, or without materials', () => {
    const character = buildCharacter(4, {
      inventory: [{ code: 'copper_bar', quantity: 1, slot: 0 }],
    });
    const wrongSkill = buildRecipe({
      code: 'wrong_skill',
      craft: {
        items: [{ code: 'copper_bar', quantity: 1 }],
        level: 1,
        quantity: 1,
        skill: 'gearcrafting',
      },
    });
    const futureRecipe = buildRecipe({
      code: 'future_recipe',
      craft: {
        items: [{ code: 'copper_bar', quantity: 1 }],
        level: 5,
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });
    const emptyRecipe = buildRecipe({
      code: 'empty_recipe',
      craft: { level: 1, quantity: 1, skill: 'weaponcrafting' },
    });
    const zeroMaterialRecipe = buildRecipe({
      code: 'zero_material_recipe',
      craft: { items: [], level: 1, quantity: 1, skill: 'weaponcrafting' },
    });
    const currentRecipe = buildRecipe({
      code: 'current_recipe',
      craft: {
        items: [{ code: 'copper_bar', quantity: 1 }],
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });

    expect(
      findBestProfessionRecipe(
        buildSnapshot([character]),
        buildState(),
        character,
        professionGoal,
        {
          items: [
            wrongSkill,
            futureRecipe,
            emptyRecipe,
            zeroMaterialRecipe,
            currentRecipe,
          ],
        },
      ),
    ).toEqual({ item: currentRecipe, missingMaterials: [], recipeLevel: 0 });
  });

  it('does not use unrelated or already-reserved bank stock', () => {
    const character = buildCharacter(4);
    const recipe = buildRecipe({
      craft: {
        items: [{ code: 'copper_bar', quantity: 2 }],
        level: 1,
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });
    const state = buildState({
      reservations: [
        {
          activity: {
            itemCode: 'copper_bar',
            quantity: 1,
            type: 'withdrawItem',
          },
          characterName: 'Kyle',
          consumes: [{ itemCode: 'copper_bar', quantity: 1 }],
          goalId: 'another-goal',
          produces: [],
        },
      ],
    });
    const snapshot = buildSnapshot(
      [character],
      [
        { code: 'copper_bar', quantity: 2 },
        { code: 'ash_wood', quantity: 100 },
      ],
    );

    expect(
      findBestProfessionRecipe(snapshot, state, character, professionGoal, {
        items: [recipe],
      }),
    ).toBeUndefined();
  });

  it('withdraws one missing recipe material before crafting', () => {
    const character = buildCharacter(4, {
      inventory: [{ code: 'copper_bar', quantity: 1, slot: 0 }],
    });
    const recipe = buildRecipe({
      craft: {
        items: [{ code: 'copper_bar', quantity: 2 }],
        level: 1,
        quantity: 1,
        skill: 'weaponcrafting',
      },
    });
    const snapshot = buildSnapshot(
      [character],
      [{ code: 'copper_bar', quantity: 1 }],
    );
    const state = buildState();

    expect(
      planProfessionProgression(snapshot, state, {
        items: [recipe],
      })._unsafeUnwrap(),
    ).toEqual({
      activities: [
        {
          activity: {
            itemCode: 'copper_bar',
            quantity: 1,
            type: 'withdrawItem',
          },
          characterName: 'Stan',
          consumes: [{ itemCode: 'copper_bar', quantity: 1 }],
          goalId: professionGoal.id,
          produces: [],
        },
      ],
      state,
    });
  });

  it('crafts once when every recipe material is held', () => {
    const character = buildCharacter(4, {
      inventory: [{ code: 'copper_bar', quantity: 2, slot: 0 }],
    });
    const recipe = buildRecipe({
      craft: {
        items: [{ code: 'copper_bar', quantity: 2 }],
        level: 1,
        skill: 'weaponcrafting',
      },
    });
    const state = buildState();

    expect(
      planProfessionProgression(buildSnapshot([character]), state, {
        items: [recipe],
      })._unsafeUnwrap(),
    ).toEqual({
      activities: [
        {
          activity: {
            itemCode: 'training_blade',
            quantity: 1,
            type: 'craftItem',
          },
          characterName: 'Stan',
          consumes: [{ itemCode: 'copper_bar', quantity: 2 }],
          goalId: professionGoal.id,
          produces: [{ itemCode: 'training_blade', quantity: 1 }],
        },
      ],
      state,
    });
  });

  it('waits when no known recipe is supported by held or banked materials', () => {
    const state = buildState();

    expect(
      planProfessionProgression(buildSnapshot([buildCharacter(4)]), state, {
        items: [buildRecipe()],
      })._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('waits while the Goal itself has a Reservation on another character', () => {
    const reservation = {
      activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
      characterName: 'Kyle',
      consumes: [],
      goalId: professionGoal.id,
      produces: [],
    };
    const state = buildState({ reservations: [reservation] });
    const character = buildCharacter(4, {
      inventory: [{ code: 'copper_bar', quantity: 1, slot: 0 }],
    });

    expect(
      planProfessionProgression(buildSnapshot([character]), state, {
        items: [buildRecipe()],
      })._unsafeUnwrap(),
    ).toEqual({ activities: [], state });
  });

  it('does not let an unrelated Reservation block profession work', () => {
    const reservation = {
      activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
      characterName: 'Kyle',
      consumes: [],
      goalId: 'another-goal',
      produces: [],
    };
    const state = buildState({ reservations: [reservation] });
    const character = buildCharacter(4, {
      inventory: [{ code: 'copper_bar', quantity: 1, slot: 0 }],
    });

    expect(
      planProfessionProgression(buildSnapshot([character]), state, {
        items: [buildRecipe()],
      })._unsafeUnwrap().activities,
    ).toHaveLength(1);
  });

  it('waits while the Goal character already has a Reservation', () => {
    const reservation = {
      activity: { monsterCode: 'chicken', type: 'fightMonster' as const },
      characterName: 'Stan',
      consumes: [],
      goalId: 'another-goal',
      produces: [],
    };
    const state = buildState({ reservations: [reservation] });
    const character = buildCharacter(4, {
      inventory: [{ code: 'copper_bar', quantity: 1, slot: 0 }],
    });

    expect(
      planProfessionProgression(buildSnapshot([character]), state, {
        items: [buildRecipe()],
      })._unsafeUnwrap(),
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
        emptyKnowledge,
      )._unsafeUnwrap(),
    ).toEqual({
      activities: [],
      state: { goals: [parentGoal], reservations: [reservation] },
    });
  });
});
