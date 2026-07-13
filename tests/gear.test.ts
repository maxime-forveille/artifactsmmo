import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { findBestGatheringTool } from "../src/bot/gear.js";
import type { components } from "../src/client/schema.js";

type Item = components["schemas"]["ItemSchema"];
type ItemPage = { data: Item[]; page: number; pages: number; size: number; total: number };

const buildItem = (overrides: Partial<Item>): Item => ({ ...({} as Item), ...overrides });

const buildItemPage = (data: Item[]): ItemPage => ({
  data,
  page: 1,
  pages: 1,
  size: 100,
  total: data.length,
});

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
