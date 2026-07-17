import { describe, expect, it } from 'vitest';

import type { CrewSnapshot } from '../src/bot/orchestration/crewSnapshot.js';
import {
  createEquipItemGoalId,
  proposeEquipmentUpgradeGoals,
} from '../src/bot/orchestration/equipmentUpgradeGoalRule.js';
import type { GoalPolicyContext } from '../src/bot/orchestration/goalPolicy.js';
import type { components } from '../src/client/schema.js';

type Character = components['schemas']['CharacterSchema'];
type Item = components['schemas']['ItemSchema'];
type Monster = components['schemas']['MonsterSchema'];

const buildCharacter = (overrides: Partial<Character> = {}): Character => ({
  ...({} as Character),
  attack_air: 0,
  attack_earth: 1,
  attack_fire: 0,
  attack_water: 0,
  critical_strike: 0,
  hp: 50,
  inventory: [],
  level: 5,
  max_hp: 100,
  name: 'Stan',
  res_air: 0,
  res_earth: 0,
  res_fire: 0,
  res_water: 0,
  weapon_slot: '',
  ...overrides,
});

const buildMonster = (overrides: Partial<Monster> = {}): Monster => ({
  ...({} as Monster),
  attack_air: 0,
  attack_earth: 20,
  attack_fire: 0,
  attack_water: 0,
  code: 'chicken',
  critical_strike: 0,
  hp: 100,
  level: 1,
  name: 'Chicken',
  res_air: 0,
  res_earth: 0,
  res_fire: 0,
  res_water: 0,
  ...overrides,
});

const buildWeapon = (overrides: Partial<Item> = {}): Item => ({
  ...({} as Item),
  code: 'copper_dagger',
  craft: { items: [], level: 1, quantity: 1, skill: 'weaponcrafting' },
  effects: [{ code: 'attack_earth', description: '', value: 20 }],
  level: 5,
  name: 'Copper Dagger',
  type: 'weapon',
  ...overrides,
});

const buildUncraftableWeapon = (overrides: Partial<Item> = {}): Item => {
  const item = buildWeapon(overrides);
  delete item.craft;
  return item;
};

const buildContext = (
  overrides: Partial<GoalPolicyContext> = {},
): GoalPolicyContext => ({
  snapshot: {
    bank: [],
    capturedAt: '2026-07-17T12:00:00.000Z',
    characters: [buildCharacter()],
  } satisfies CrewSnapshot,
  state: { goals: [], reservations: [] },
  world: { items: [buildWeapon()], monsters: [buildMonster()], resources: [] },
  ...overrides,
});

describe('createEquipItemGoalId', () => {
  it('creates a stable semantic id from the character and item', () => {
    expect(createEquipItemGoalId('Stan', 'copper_dagger')).toBe(
      'equipItem:Stan:copper_dagger',
    );
  });
});

describe('proposeEquipmentUpgradeGoals', () => {
  it('proposes a weapon upgrade when no level-appropriate combat is safe', () => {
    expect(proposeEquipmentUpgradeGoals(buildContext())).toEqual([
      {
        goal: {
          characterName: 'Stan',
          id: 'equipItem:Stan:copper_dagger',
          itemCode: 'copper_dagger',
          type: 'equipItem',
        },
        reason: 'Stan needs copper_dagger to improve combat against chicken',
        utility: 1,
      },
    ]);
  });

  it('keeps safe combat ahead of optional equipment upgrades', () => {
    const safeMonster = buildMonster({ attack_earth: 1, hp: 10 });
    const context = buildContext({
      world: { items: [buildWeapon()], monsters: [safeMonster], resources: [] },
    });

    expect(proposeEquipmentUpgradeGoals(context)).toEqual([]);
  });

  it('only considers equippable weapons that can be obtained', () => {
    const bankedWeapon = buildUncraftableWeapon({ code: 'banked_sword' });
    const unavailableWeapon = buildUncraftableWeapon({
      code: 'unavailable_sword',
      effects: [{ code: 'attack_earth', description: '', value: 80 }],
    });
    const highLevelWeapon = buildWeapon({
      code: 'high_level_sword',
      effects: [{ code: 'attack_earth', description: '', value: 100 }],
      level: 6,
    });
    const nonWeapon = buildWeapon({
      code: 'powerful_helmet',
      effects: [{ code: 'attack_earth', description: '', value: 120 }],
      type: 'helmet',
    });
    const context = buildContext({
      snapshot: {
        bank: [
          { code: 'ash_wood', quantity: 1 },
          { code: bankedWeapon.code, quantity: 1 },
          { code: unavailableWeapon.code, quantity: 0 },
        ],
        capturedAt: '2026-07-17T12:00:00.000Z',
        characters: [buildCharacter()],
      },
      world: {
        items: [bankedWeapon, unavailableWeapon, highLevelWeapon, nonWeapon],
        monsters: [buildMonster()],
        resources: [],
      },
    });

    expect(proposeEquipmentUpgradeGoals(context)[0]?.goal).toEqual({
      characterName: 'Stan',
      id: 'equipItem:Stan:banked_sword',
      itemCode: 'banked_sword',
      type: 'equipItem',
    });
  });

  it('can use a weapon held by another crew member', () => {
    const heldWeapon = buildUncraftableWeapon({ code: 'held_sword' });
    const context = buildContext({
      snapshot: {
        bank: [],
        capturedAt: '2026-07-17T12:00:00.000Z',
        characters: [
          buildCharacter(),
          buildCharacter({
            inventory: [{ code: heldWeapon.code, quantity: 1, slot: 0 }],
            name: 'Kyle',
          }),
        ],
      },
      world: { items: [heldWeapon], monsters: [buildMonster()], resources: [] },
    });

    expect(proposeEquipmentUpgradeGoals(context)[0]?.goal).toEqual({
      characterName: 'Stan',
      id: 'equipItem:Stan:held_sword',
      itemCode: 'held_sword',
      type: 'equipItem',
    });
  });

  it('does not propose the weapon that is already equipped', () => {
    const weapon = buildUncraftableWeapon();
    const context = buildContext({
      snapshot: {
        bank: [],
        capturedAt: '2026-07-17T12:00:00.000Z',
        characters: [
          buildCharacter({ attack_earth: 21, weapon_slot: weapon.code }),
        ],
      },
      world: { items: [weapon], monsters: [buildMonster()], resources: [] },
    });

    expect(proposeEquipmentUpgradeGoals(context)).toEqual([]);
  });

  it('compares an upgrade after removing the current weapon contribution', () => {
    const currentWeapon = buildUncraftableWeapon({
      code: 'wooden_stick',
      effects: [{ code: 'attack_earth', description: '', value: 10 }],
    });
    const betterWeapon = buildWeapon({
      effects: [{ code: 'attack_earth', description: '', value: 20 }],
    });
    const context = buildContext({
      snapshot: {
        bank: [],
        capturedAt: '2026-07-17T12:00:00.000Z',
        characters: [
          buildCharacter({ attack_earth: 11, weapon_slot: currentWeapon.code }),
        ],
      },
      world: {
        items: [currentWeapon, betterWeapon],
        monsters: [buildMonster()],
        resources: [],
      },
    });

    expect(proposeEquipmentUpgradeGoals(context)[0]?.goal).toEqual({
      characterName: 'Stan',
      id: 'equipItem:Stan:copper_dagger',
      itemCode: 'copper_dagger',
      type: 'equipItem',
    });
  });

  it('chooses the lowest-level challenge with code as a stable tie-breaker', () => {
    const levelFive = buildMonster({ code: 'level_five', level: 5 });
    const zLevelOne = buildMonster({ code: 'z_level_one', level: 1 });
    const aLevelOne = buildMonster({ code: 'a_level_one', level: 1 });
    const context = buildContext({
      world: {
        items: [buildWeapon()],
        monsters: [levelFive, zLevelOne, aLevelOne],
        resources: [],
      },
    });

    expect(proposeEquipmentUpgradeGoals(context)[0]?.reason).toBe(
      'Stan needs copper_dagger to improve combat against a_level_one',
    );
  });

  it('considers a monster exactly at the character level', () => {
    const context = buildContext({
      world: {
        items: [buildWeapon()],
        monsters: [buildMonster({ level: 5 })],
        resources: [],
      },
    });

    expect(proposeEquipmentUpgradeGoals(context)).toHaveLength(1);
  });

  it('does not propose equipment without a level-appropriate combat target', () => {
    const context = buildContext({
      world: {
        items: [buildWeapon()],
        monsters: [buildMonster({ level: 6 })],
        resources: [],
      },
    });

    expect(proposeEquipmentUpgradeGoals(context)).toEqual([]);
  });

  it('does not propose equipment when no obtainable weapon can improve combat', () => {
    const context = buildContext({
      world: { items: [], monsters: [buildMonster()], resources: [] },
    });

    expect(proposeEquipmentUpgradeGoals(context)).toEqual([]);
  });
});
