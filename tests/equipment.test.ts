import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { craftAndEquip, UnsupportedEquipSlotError } from "../src/bot/strategies/equipment.js";
import { ResourceNotFoundError } from "../src/bot/world.js";
import { ArtifactsApiError } from "../src/client/index.js";
import type { components } from "../src/client/schema.js";

type ItemResponse = components["schemas"]["ItemResponseSchema"];
type Item = components["schemas"]["ItemSchema"];
type CharacterSnapshot = components["schemas"]["CharacterSchema"];
type MapPage = components["schemas"]["StaticDataPage_MapSchema_"];
type Map = components["schemas"]["MapSchema"];
type ResourcePage = components["schemas"]["StaticDataPage_ResourceSchema_"];
type Resource = components["schemas"]["ResourceSchema"];
type Cooldown = components["schemas"]["CooldownSchema"];

const buildCooldown = (): Cooldown => ({
  expiration: "2024-01-01T00:00:05.000Z",
  reason: "crafting",
  remaining_seconds: 0,
  started_at: "2024-01-01T00:00:00.000Z",
  total_seconds: 0,
});

const buildMap = (mapId: number): Map => ({ ...({} as Map), map_id: mapId });
const buildMapPage = (data: Map[]): MapPage => ({
  data,
  page: 1,
  pages: 1,
  size: 50,
  total: data.length,
});
const buildResource = (code: string): Resource => ({ ...({} as Resource), code });
const buildResourcePage = (data: Resource[]): ResourcePage => ({
  data,
  page: 1,
  pages: 1,
  size: 50,
  total: data.length,
});

const buildItem = (overrides: Partial<Item>): Item => ({
  ...({} as Item),
  ...overrides,
});

/** A tiny in-memory character whose inventory is mutated by gather/craft, like the real agent would be. */
const createFakeCharacterState = () => {
  const held = new Map<string, number>();

  const getCharacter = (): CharacterSnapshot =>
    ({
      ...({} as CharacterSnapshot),
      inventory: [...held.entries()].map(([code, quantity], index) => ({
        code,
        quantity,
        slot: index,
      })),
      name: "Cartman",
    }) as CharacterSnapshot;

  const add = (code: string, quantity: number) => held.set(code, (held.get(code) ?? 0) + quantity);
  const remove = (code: string, quantity: number) =>
    held.set(code, (held.get(code) ?? 0) - quantity);

  return { add, getCharacter, remove };
};

describe("craftAndEquip", () => {
  it("gathers the raw material, crafts the intermediate, crafts the final item, then equips it", async () => {
    const state = createFakeCharacterState();

    const getItem = vi.fn((code: string) => {
      if (code === "copper_pickaxe") {
        return okAsync({
          data: buildItem({
            code: "copper_pickaxe",
            craft: {
              items: [{ code: "copper_bar", quantity: 6 }],
              level: 1,
              quantity: 1,
              skill: "weaponcrafting",
            },
            type: "weapon",
          }),
        } satisfies ItemResponse);
      }
      if (code === "copper_bar") {
        return okAsync({
          data: buildItem({
            code: "copper_bar",
            craft: {
              items: [{ code: "copper_ore", quantity: 10 }],
              level: 1,
              quantity: 1,
              skill: "mining",
            },
            type: "resource",
          }),
        } satisfies ItemResponse);
      }
      // copper_ore: no craft recipe, a raw resource drop.
      return okAsync({
        data: buildItem({ code: "copper_ore", type: "resource" }),
      } satisfies ItemResponse);
    });

    const getMaps = vi.fn((query?: { content_type?: string }) =>
      okAsync(
        buildMapPage([
          buildMap(
            query?.content_type === "workshop" ? 328 : query?.content_type === "resource" ? 277 : 0,
          ),
        ]),
      ),
    );
    const getResources = vi.fn(() => okAsync(buildResourcePage([buildResource("copper_rocks")])));

    const moveTo = vi.fn(() => okAsync(undefined));
    const gather = vi.fn(() => {
      state.add("copper_ore", 1);
      return okAsync({
        character: state.getCharacter(),
        cooldown: buildCooldown(),
        details: { items: [], xp: 5 },
      });
    });
    const craft = vi.fn((code: string, quantity = 1) => {
      if (code === "copper_bar") {
        state.remove("copper_ore", quantity * 10);
        state.add("copper_bar", quantity);
      } else if (code === "copper_pickaxe") {
        state.remove("copper_bar", quantity * 6);
        state.add("copper_pickaxe", quantity);
      }
      return okAsync({
        character: state.getCharacter(),
        cooldown: buildCooldown(),
        details: { items: [], xp: 5 },
      });
    });
    const equip = vi.fn(() =>
      okAsync({ character: state.getCharacter(), cooldown: buildCooldown(), items: [] }),
    );

    const result = await craftAndEquip(
      { getItem, getMaps, getResources },
      { craft, equip, gather, getCharacter: state.getCharacter, moveTo },
      "copper_pickaxe",
    );

    expect(result.isOk()).toBe(true);
    expect(gather).toHaveBeenCalledTimes(60); // 6 bars x 10 ore each
    expect(craft).toHaveBeenCalledWith("copper_bar", 6);
    expect(craft).toHaveBeenCalledWith("copper_pickaxe", 1);
    expect(equip).toHaveBeenCalledWith([{ code: "copper_pickaxe", quantity: 1, slot: "weapon" }]);
  });

  it("skips gathering/crafting materials already held in sufficient quantity", async () => {
    const state = createFakeCharacterState();
    state.add("copper_bar", 6);

    const getItem = vi.fn((code: string) =>
      code === "copper_pickaxe"
        ? okAsync({
            data: buildItem({
              code: "copper_pickaxe",
              craft: {
                items: [{ code: "copper_bar", quantity: 6 }],
                level: 1,
                quantity: 1,
                skill: "weaponcrafting",
              },
              type: "weapon",
            }),
          } satisfies ItemResponse)
        : okAsync({ data: buildItem({ code }) } satisfies ItemResponse),
    );
    const getMaps = vi.fn(() => okAsync(buildMapPage([buildMap(328)])));
    const getResources = vi.fn();
    const moveTo = vi.fn(() => okAsync(undefined));
    const gather = vi.fn();
    const craft = vi.fn((code: string, quantity = 1) => {
      state.remove("copper_bar", quantity * 6);
      state.add(code, quantity);
      return okAsync({
        character: state.getCharacter(),
        cooldown: buildCooldown(),
        details: { items: [], xp: 5 },
      });
    });
    const equip = vi.fn(() =>
      okAsync({ character: state.getCharacter(), cooldown: buildCooldown(), items: [] }),
    );

    const result = await craftAndEquip(
      { getItem, getMaps, getResources },
      { craft, equip, gather, getCharacter: state.getCharacter, moveTo },
      "copper_pickaxe",
    );

    expect(result.isOk()).toBe(true);
    expect(gather).not.toHaveBeenCalled();
    expect(getResources).not.toHaveBeenCalled();
    expect(craft).toHaveBeenCalledTimes(1);
    expect(craft).toHaveBeenCalledWith("copper_pickaxe", 1);
  });

  it("returns UnsupportedEquipSlotError for an item type without a known slot", async () => {
    const getItem = vi.fn(() =>
      okAsync({ data: buildItem({ code: "strange_artifact", type: "artifact" }) }),
    );
    const equip = vi.fn();

    const result = await craftAndEquip(
      { getItem, getMaps: vi.fn(), getResources: vi.fn() },
      {
        craft: vi.fn(),
        equip,
        gather: vi.fn(),
        getCharacter: () => ({}) as CharacterSnapshot,
        moveTo: vi.fn(),
      },
      "strange_artifact",
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnsupportedEquipSlotError);
    expect(equip).not.toHaveBeenCalled();
  });

  it("propagates a ResourceNotFoundError when a raw material can't be gathered", async () => {
    const state = createFakeCharacterState();

    const getItem = vi.fn((code: string) =>
      code === "apprentice_gloves"
        ? okAsync({
            data: buildItem({
              code: "apprentice_gloves",
              craft: {
                items: [{ code: "feather", quantity: 6 }],
                level: 1,
                quantity: 1,
                skill: "weaponcrafting",
              },
              type: "weapon",
            }),
          } satisfies ItemResponse)
        : okAsync({ data: buildItem({ code }) } satisfies ItemResponse),
    );
    const getMaps = vi.fn(() => okAsync(buildMapPage([buildMap(328)])));
    const getResources = vi.fn(() => okAsync(buildResourcePage([]))); // nothing drops "feather"

    const result = await craftAndEquip(
      { getItem, getMaps, getResources },
      {
        craft: vi.fn(),
        equip: vi.fn(),
        gather: vi.fn(),
        getCharacter: state.getCharacter,
        moveTo: vi.fn(() => okAsync(undefined)),
      },
      "apprentice_gloves",
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ResourceNotFoundError);
  });

  it("propagates an ArtifactsApiError from a failed craft call", async () => {
    const state = createFakeCharacterState();
    state.add("copper_bar", 6);
    const apiError = new ArtifactsApiError("not enough materials", 478, undefined);

    const getItem = vi.fn(() =>
      okAsync({
        data: buildItem({
          code: "copper_pickaxe",
          craft: {
            items: [{ code: "copper_bar", quantity: 6 }],
            level: 1,
            quantity: 1,
            skill: "weaponcrafting",
          },
          type: "weapon",
        }),
      } satisfies ItemResponse),
    );
    const getMaps = vi.fn(() => okAsync(buildMapPage([buildMap(328)])));

    const result = await craftAndEquip(
      { getItem, getMaps, getResources: vi.fn() },
      {
        craft: vi.fn(() => errAsync(apiError)),
        equip: vi.fn(),
        gather: vi.fn(),
        getCharacter: state.getCharacter,
        moveTo: vi.fn(() => okAsync(undefined)),
      },
      "copper_pickaxe",
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe(apiError);
  });
});
