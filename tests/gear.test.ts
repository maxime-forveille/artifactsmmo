import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { findBestCombatWeapon, findBestGatheringTool } from "../src/bot/gear.js";
import type { components } from "../src/client/schema.js";

type Character = components["schemas"]["CharacterSchema"];
type Item = components["schemas"]["ItemSchema"];
type ItemPage = { data: Item[]; page: number; pages: number; size: number; total: number };
type Monster = components["schemas"]["MonsterSchema"];

const buildItem = (overrides: Partial<Item>): Item => ({ ...({} as Item), ...overrides });

const buildItemPage = (data: Item[]): ItemPage => ({
  data,
  page: 1,
  pages: 1,
  size: 100,
  total: data.length,
});

// Full set of combat stats needed by averageDamagePerTurn, all zeroed out by
// default so tests can override just the fields they care about.
const buildCharacter = (overrides: Partial<Character> = {}): Character =>
  ({
    attack_air: 0,
    attack_earth: 0,
    attack_fire: 0,
    attack_water: 0,
    critical_strike: 0,
    dmg: 0,
    dmg_air: 0,
    dmg_earth: 0,
    dmg_fire: 0,
    dmg_water: 0,
    level: 1,
    res_air: 0,
    res_earth: 0,
    res_fire: 0,
    res_water: 0,
    weapon_slot: "",
    ...overrides,
  }) as Character;

const buildMonster = (overrides: Partial<Monster> = {}): Monster =>
  ({
    attack_air: 0,
    attack_earth: 0,
    attack_fire: 0,
    attack_water: 0,
    code: "chicken",
    critical_strike: 0,
    hp: 60,
    level: 1,
    res_air: 0,
    res_earth: 0,
    res_fire: 0,
    res_water: 0,
    ...overrides,
  }) as Monster;

describe("findBestGatheringTool", () => {
  it("picks the weapon with the largest cooldown reduction for the given skill", async () => {
    const weakPickaxe = buildItem({
      code: "weak_pickaxe",
      effects: [{ code: "mining", description: "", value: -5 }],
    });
    const strongPickaxe = buildItem({
      code: "strong_pickaxe",
      effects: [{ code: "mining", description: "", value: -20 }],
    });
    const unrelatedWeapon = buildItem({
      code: "copper_dagger",
      effects: [{ code: "critical_strike", description: "", value: 35 }],
    });
    const getItems = vi.fn(() =>
      okAsync(buildItemPage([weakPickaxe, unrelatedWeapon, strongPickaxe])),
    );

    const result = await findBestGatheringTool({ getItems }, "mining", 5);

    expect(getItems).toHaveBeenCalledWith({ max_level: 5, size: 100, type: "weapon" });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.code).toBe("strong_pickaxe");
  });

  it("returns undefined when no weapon grants the requested skill", async () => {
    const unrelatedWeapon = buildItem({
      code: "copper_dagger",
      effects: [{ code: "critical_strike", description: "", value: 35 }],
    });
    const getItems = vi.fn(() => okAsync(buildItemPage([unrelatedWeapon])));

    const result = await findBestGatheringTool({ getItems }, "woodcutting", 5);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it("ignores a matching effect with a non-negative value", async () => {
    const notActuallyAReduction = buildItem({
      code: "weird_tool",
      effects: [{ code: "fishing", description: "", value: 5 }],
    });
    const getItems = vi.fn(() => okAsync(buildItemPage([notActuallyAReduction])));

    const result = await findBestGatheringTool({ getItems }, "fishing", 5);

    expect(result._unsafeUnwrap()).toBeUndefined();
  });
});

describe("findBestCombatWeapon", () => {
  it("picks the weapon that deals the most damage against the monster's weakest resistance", async () => {
    const character = buildCharacter({ weapon_slot: "" });
    const monster = buildMonster({ res_air: 80, res_earth: 0 });
    const airWeapon = buildItem({
      code: "air_weapon",
      effects: [{ code: "attack_air", description: "", value: 20 }],
    });
    const earthWeapon = buildItem({
      code: "earth_weapon",
      effects: [{ code: "attack_earth", description: "", value: 20 }],
    });
    const getItems = vi.fn(() => okAsync(buildItemPage([airWeapon, earthWeapon])));
    const getItem = vi.fn();

    const result = await findBestCombatWeapon({ getItem, getItems }, character, monster, 5);

    expect(getItem).not.toHaveBeenCalled();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.code).toBe("earth_weapon");
  });

  it("removes the currently equipped weapon's own contribution before comparing candidates", async () => {
    // The character's attack_earth (30) already includes the equipped
    // weak_earth_weapon's +10; findBestCombatWeapon must not double-count
    // that when it re-adds strong_earth_weapon's own +25.
    const character = buildCharacter({ attack_earth: 30, weapon_slot: "weak_earth_weapon" });
    const monster = buildMonster();
    const equippedWeapon = buildItem({
      code: "weak_earth_weapon",
      effects: [{ code: "attack_earth", description: "", value: 10 }],
    });
    const strongerWeapon = buildItem({
      code: "strong_earth_weapon",
      effects: [{ code: "attack_earth", description: "", value: 25 }],
    });
    const getItem = vi.fn(() => okAsync({ data: equippedWeapon }));
    const getItems = vi.fn(() => okAsync(buildItemPage([equippedWeapon, strongerWeapon])));

    const result = await findBestCombatWeapon({ getItem, getItems }, character, monster, 5);

    expect(getItem).toHaveBeenCalledWith("weak_earth_weapon");
    expect(result._unsafeUnwrap()?.code).toBe("strong_earth_weapon");
  });

  it("returns undefined when nothing found deals any damage", async () => {
    const character = buildCharacter();
    const monster = buildMonster({ res_air: 100, res_earth: 100, res_fire: 100, res_water: 100 });
    const uselessWeapon = buildItem({
      code: "useless_weapon",
      effects: [{ code: "attack_fire", description: "", value: 5 }],
    });
    const getItem = vi.fn();
    const getItems = vi.fn(() => okAsync(buildItemPage([uselessWeapon])));

    const result = await findBestCombatWeapon({ getItem, getItems }, character, monster, 5);

    expect(result._unsafeUnwrap()).toBeUndefined();
  });
});
