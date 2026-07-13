import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { fightSafely } from "../src/bot/combat.js";
import type { components } from "../src/client/schema.js";

type CharacterSnapshot = components["schemas"]["CharacterSchema"];
type Cooldown = components["schemas"]["CooldownSchema"];
type FightResult = components["schemas"]["FightResult"];

const buildCooldown = (): Cooldown => ({
  expiration: "2024-01-01T00:00:05.000Z",
  reason: "fight",
  remaining_seconds: 5,
  started_at: "2024-01-01T00:00:00.000Z",
  total_seconds: 5,
});

const buildCharacter = (overrides: Partial<CharacterSnapshot> = {}): CharacterSnapshot => ({
  ...({} as CharacterSnapshot),
  hp: 100,
  max_hp: 100,
  name: "Cartman",
  ...overrides,
});

const buildFightResult = (result: FightResult, character: CharacterSnapshot) => ({
  character,
  characters: [],
  cooldown: buildCooldown(),
  fight: { characters: [], logs: [], opponent: "chicken", result, turns: 3 },
});

describe("fightSafely", () => {
  it("fights immediately without resting when HP is above the safety threshold", async () => {
    const character = buildCharacter({ hp: 80, max_hp: 100 });
    const fight = vi.fn(() => okAsync(buildFightResult("win", character)));
    const rest = vi.fn();

    const result = await fightSafely({ fight, getCharacter: () => character, rest });

    expect(rest).not.toHaveBeenCalled();
    expect(fight).toHaveBeenCalledTimes(1);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().fight.result).toBe("win");
  });

  it("rests first when HP drops below half, then fights", async () => {
    const character = buildCharacter({ hp: 40, max_hp: 100 });
    const restedCharacter = buildCharacter({ hp: 100, max_hp: 100 });
    const rest = vi.fn(() =>
      okAsync({ character: restedCharacter, cooldown: buildCooldown(), hp_restored: 60 }),
    );
    const fight = vi.fn(() => okAsync(buildFightResult("win", restedCharacter)));

    const result = await fightSafely({ fight, getCharacter: () => character, rest });

    expect(rest).toHaveBeenCalledTimes(1);
    expect(fight).toHaveBeenCalledTimes(1);
    expect(result.isOk()).toBe(true);
  });

  it("does not fail the result when a fight is lost, just logs it", async () => {
    const character = buildCharacter({ hp: 80, max_hp: 100 });
    const fight = vi.fn(() => okAsync(buildFightResult("loss", character)));
    const rest = vi.fn();

    const result = await fightSafely({ fight, getCharacter: () => character, rest });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().fight.result).toBe("loss");
  });
});
