import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { findNextSafeMonster } from "../src/bot/progression.js";
import { ArtifactsApiError } from "../src/client/index.js";
import type { ArtifactsClient } from "../src/client/index.js";
import type { components } from "../src/client/schema.js";

type Character = components["schemas"]["CharacterSchema"];
type Monster = components["schemas"]["MonsterSchema"];
type MonsterPage = components["schemas"]["StaticDataPage_MonsterSchema_"];

const buildCharacter = (overrides: Partial<Character> = {}): Character =>
  ({
    attack_air: 0,
    attack_earth: 20,
    attack_fire: 0,
    attack_water: 0,
    critical_strike: 0,
    dmg: 0,
    dmg_air: 0,
    dmg_earth: 0,
    dmg_fire: 0,
    dmg_water: 0,
    hp: 150,
    level: 4,
    res_air: 0,
    res_earth: 0,
    res_fire: 0,
    res_water: 0,
    ...overrides,
  }) as Character;

const buildMonster = (overrides: Partial<Monster> = {}): Monster =>
  ({
    attack_air: 0,
    attack_earth: 0,
    attack_fire: 0,
    attack_water: 4,
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

const buildMonsterPage = (data: Monster[]): MonsterPage => ({
  data,
  page: 1,
  pages: 1,
  size: 50,
  total: data.length,
});

describe("findNextSafeMonster", () => {
  it("picks the highest-level monster that's still safe", async () => {
    const character = buildCharacter();
    const weak = buildMonster({ code: "chicken", hp: 60, level: 1 });
    // Both safe for this character (attack_earth 20, hp 150); the level 2
    // one should win over the level 1 one.
    const safeAndStronger = buildMonster({ code: "yellow_slime", hp: 70, level: 2 });
    const getMonsters = vi.fn(() => okAsync(buildMonsterPage([weak, safeAndStronger])));

    const result = await findNextSafeMonster({ getMonsters }, character);

    expect(getMonsters).toHaveBeenCalledWith({ max_level: character.level });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.code).toBe("yellow_slime");
  });

  it("skips monsters that aren't safe, even if higher level", async () => {
    const character = buildCharacter();
    const safe = buildMonster({ code: "chicken", hp: 60, level: 1 });
    // Way too tanky/hard-hitting for this character to be worth it.
    const unsafe = buildMonster({
      attack_earth: 100,
      code: "cow",
      hp: 2_000,
      level: 8,
    });
    const getMonsters = vi.fn(() => okAsync(buildMonsterPage([safe, unsafe])));

    const result = await findNextSafeMonster({ getMonsters }, character);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.code).toBe("chicken");
  });

  it("returns undefined when no monster is safe", async () => {
    const character = buildCharacter({ attack_earth: 1, hp: 10 });
    const unsafe = buildMonster({ attack_earth: 100, code: "cow", hp: 2_000, level: 8 });
    const getMonsters = vi.fn(() => okAsync(buildMonsterPage([unsafe])));

    const result = await findNextSafeMonster({ getMonsters }, character);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it("propagates a getMonsters failure without swallowing it", async () => {
    const apiError = new ArtifactsApiError("boom", 500, undefined);
    const getMonsters = vi.fn(() => errAsync(apiError));

    const result = await findNextSafeMonster(
      { getMonsters } as Pick<ArtifactsClient, "getMonsters">,
      buildCharacter(),
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe(apiError);
  });
});
