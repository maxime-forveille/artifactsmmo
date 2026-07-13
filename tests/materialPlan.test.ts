import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { findCraftableFromBankSurplus, materialsNeededFor } from "../src/bot/materialPlan.js";
import { ArtifactsApiError } from "../src/client/index.js";
import type { components } from "../src/client/schema.js";

type Character = components["schemas"]["CharacterSchema"];
type Item = components["schemas"]["ItemSchema"];
type ItemResponse = components["schemas"]["ItemResponseSchema"];
type Monster = components["schemas"]["MonsterSchema"];
type MonsterPage = components["schemas"]["StaticDataPage_MonsterSchema_"];
type Resource = components["schemas"]["ResourceSchema"];
type ResourcePage = components["schemas"]["StaticDataPage_ResourceSchema_"];
type InventorySlot = components["schemas"]["InventorySlotSchema"];
type SimpleItem = components["schemas"]["SimpleItemSchema"];
type BankItemsPage = components["schemas"]["DataPage_SimpleItemSchema_"];

const buildCharacter = (
  inventory: InventorySlot[] = [],
  overrides: Partial<Character> = {},
): Character =>
  ({
    ...({} as Character),
    inventory,
    name: "Cartman",
    ...overrides,
  }) as Character;

const buildItem = (overrides: Partial<Item>): Item => ({ ...({} as Item), ...overrides });
const buildItemResponse = (item: Item): ItemResponse => ({ data: item });

const buildResource = (code: string): Resource => ({ ...({} as Resource), code });
const buildResourcePage = (data: Resource[]): ResourcePage => ({
  data,
  page: 1,
  pages: 1,
  size: 50,
  total: data.length,
});

const buildMonster = (code: string): Monster => ({ ...({} as Monster), code });
const buildMonsterPage = (data: Monster[]): MonsterPage => ({
  data,
  page: 1,
  pages: 1,
  size: 50,
  total: data.length,
});

const buildBankItemsPage = (data: SimpleItem[]): BankItemsPage => ({
  data,
  page: 1,
  pages: 1,
  size: 50,
  total: data.length,
});
const emptyBank = () => vi.fn(() => okAsync(buildBankItemsPage([])));
const noResources = () => vi.fn(() => okAsync(buildResourcePage([])));
const noMonsters = () => vi.fn(() => okAsync(buildMonsterPage([])));

type ItemPage = { data: Item[]; page: number; pages: number; size: number; total: number };
const buildItemPage = (data: Item[]): ItemPage => ({
  data,
  page: 1,
  pages: 1,
  size: 100,
  total: data.length,
});

describe("materialsNeededFor", () => {
  it("returns nothing already held in enough quantity, without calling the API", async () => {
    const character = buildCharacter([{ code: "ash_wood", quantity: 5, slot: 0 }]);
    const getItem = vi.fn();

    const result = await materialsNeededFor(
      {
        getBankItems: emptyBank(),
        getItem,
        getMonsters: noMonsters(),
        getResources: noResources(),
      },
      character,
      "ash_wood",
      3,
    );

    expect(result.isOk() && result.value).toEqual([]);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("counts the bank towards what's needed, returning nothing missing when it covers the gap", async () => {
    const character = buildCharacter([{ code: "ash_wood", quantity: 1, slot: 0 }]);
    const getItem = vi.fn(() => okAsync(buildItemResponse(buildItem({ code: "ash_wood" }))));
    const getBankItems = vi.fn(() =>
      okAsync(buildBankItemsPage([{ code: "ash_wood", quantity: 4 }])),
    );

    const result = await materialsNeededFor(
      { getBankItems, getItem, getMonsters: noMonsters(), getResources: noResources() },
      character,
      "ash_wood",
      5,
    );

    expect(result.isOk() && result.value).toEqual([]);
  });

  it("reports a missing raw material as gatherable, when a resource drops it", async () => {
    const character = buildCharacter();
    const getItem = vi.fn(() => okAsync(buildItemResponse(buildItem({ code: "ash_wood" }))));
    const getResources = vi.fn(() => okAsync(buildResourcePage([buildResource("ash_tree")])));

    const result = await materialsNeededFor(
      { getBankItems: emptyBank(), getItem, getMonsters: noMonsters(), getResources },
      character,
      "ash_wood",
      3,
    );

    expect(result.isOk() && result.value).toEqual([
      {
        itemCode: "ash_wood",
        missingQuantity: 3,
        source: { resourceCode: "ash_tree", type: "gather" },
      },
    ]);
  });

  it("falls back to a monster drop when no resource produces the raw material", async () => {
    const character = buildCharacter();
    const getItem = vi.fn(() => okAsync(buildItemResponse(buildItem({ code: "feather" }))));
    const getMonsters = vi.fn(() => okAsync(buildMonsterPage([buildMonster("chicken")])));

    const result = await materialsNeededFor(
      { getBankItems: emptyBank(), getItem, getMonsters, getResources: noResources() },
      character,
      "feather",
      2,
    );

    expect(result.isOk() && result.value).toEqual([
      { itemCode: "feather", missingQuantity: 2, source: { monsterCode: "chicken", type: "hunt" } },
    ]);
  });

  it("classifies as unknown when neither a resource nor a monster produces the raw material", async () => {
    const character = buildCharacter();
    const getItem = vi.fn(() => okAsync(buildItemResponse(buildItem({ code: "mystery_shard" }))));

    const result = await materialsNeededFor(
      {
        getBankItems: emptyBank(),
        getItem,
        getMonsters: noMonsters(),
        getResources: noResources(),
      },
      character,
      "mystery_shard",
      1,
    );

    expect(result.isOk() && result.value).toEqual([
      { itemCode: "mystery_shard", missingQuantity: 1, source: { type: "unknown" } },
    ]);
  });

  it("recurses into craft materials instead of reporting the craftable item itself", async () => {
    const character = buildCharacter();
    const getItem = vi.fn((code: string) => {
      if (code === "wooden_staff") {
        return okAsync(
          buildItemResponse(
            buildItem({
              code: "wooden_staff",
              craft: {
                items: [
                  { code: "ash_wood", quantity: 2 },
                  { code: "feather", quantity: 1 },
                ],
                level: 1,
                quantity: 1,
                skill: "weaponcrafting",
              },
              type: "weapon",
            }),
          ),
        );
      }

      if (code === "ash_wood") {
        return okAsync(buildItemResponse(buildItem({ code: "ash_wood" })));
      }

      return okAsync(buildItemResponse(buildItem({ code: "feather" })));
    });
    const getResources = vi.fn((query?: { drop?: string }) =>
      okAsync(buildResourcePage(query?.drop === "ash_wood" ? [buildResource("ash_tree")] : [])),
    );
    const getMonsters = vi.fn((query?: { drop?: string }) =>
      okAsync(buildMonsterPage(query?.drop === "feather" ? [buildMonster("chicken")] : [])),
    );

    const result = await materialsNeededFor(
      { getBankItems: emptyBank(), getItem, getMonsters, getResources },
      character,
      "wooden_staff",
      2,
    );

    expect(result.isOk() && result.value).toEqual([
      {
        itemCode: "ash_wood",
        missingQuantity: 4,
        source: { resourceCode: "ash_tree", type: "gather" },
      },
      { itemCode: "feather", missingQuantity: 2, source: { monsterCode: "chicken", type: "hunt" } },
    ]);
  });

  it("propagates a genuine API error instead of downgrading it to unknown", async () => {
    const character = buildCharacter();
    const apiError = new ArtifactsApiError("boom", 500, {});
    const getItem = vi.fn(() => okAsync(buildItemResponse(buildItem({ code: "ash_wood" }))));
    const getResources = vi.fn(() => errAsync(apiError));
    const getMonsters = noMonsters();

    const result = await materialsNeededFor(
      { getBankItems: emptyBank(), getItem, getMonsters, getResources },
      character,
      "ash_wood",
      1,
    );

    expect(result.isErr() && result.error).toBe(apiError);
    expect(getMonsters).not.toHaveBeenCalled();
  });
});

describe("findCraftableFromBankSurplus", () => {
  it("returns nothing when the bank is empty, without looking up any recipes", async () => {
    const character = buildCharacter([], { weaponcrafting_level: 1 });
    const getItems = vi.fn();

    const result = await findCraftableFromBankSurplus(
      { getBankItems: emptyBank(), getItems },
      character,
    );

    expect(result.isOk() && result.value).toEqual([]);
    expect(getItems).not.toHaveBeenCalled();
  });

  it("finds an item craftable from a bank surplus material, within the character's profession level", async () => {
    const character = buildCharacter([], { weaponcrafting_level: 1 });
    const woodenStaff = buildItem({
      code: "wooden_staff",
      craft: {
        items: [{ code: "ash_wood", quantity: 2 }],
        level: 1,
        quantity: 1,
        skill: "weaponcrafting",
      },
      type: "weapon",
    });
    const getBankItems = vi.fn((query?: { item_code?: string }) =>
      okAsync(
        buildBankItemsPage(
          query?.item_code === undefined || query.item_code === "ash_wood"
            ? [{ code: "ash_wood", quantity: 10 }]
            : [],
        ),
      ),
    );
    const getItems = vi.fn(() => okAsync(buildItemPage([woodenStaff])));

    const result = await findCraftableFromBankSurplus({ getBankItems, getItems }, character);

    expect(getItems).toHaveBeenCalledWith({ craft_material: "ash_wood", size: 100 });
    expect(result.isOk() && result.value).toEqual([
      { craftableQuantity: 5, itemCode: "wooden_staff", skill: "weaponcrafting" },
    ]);
  });

  it("excludes a candidate whose profession level requirement isn't met yet", async () => {
    const character = buildCharacter([], { weaponcrafting_level: 0 });
    const woodenStaff = buildItem({
      code: "wooden_staff",
      craft: {
        items: [{ code: "ash_wood", quantity: 2 }],
        level: 1,
        quantity: 1,
        skill: "weaponcrafting",
      },
      type: "weapon",
    });
    const getBankItems = vi.fn((query?: { item_code?: string }) =>
      okAsync(
        buildBankItemsPage(
          query?.item_code === undefined || query.item_code === "ash_wood"
            ? [{ code: "ash_wood", quantity: 10 }]
            : [],
        ),
      ),
    );
    const getItems = vi.fn(() => okAsync(buildItemPage([woodenStaff])));

    const result = await findCraftableFromBankSurplus({ getBankItems, getItems }, character);

    expect(result.isOk() && result.value).toEqual([]);
  });

  it("excludes a candidate missing enough of a second required material", async () => {
    const character = buildCharacter([], { weaponcrafting_level: 1 });
    const woodenStaff = buildItem({
      code: "wooden_staff",
      craft: {
        items: [
          { code: "ash_wood", quantity: 2 },
          { code: "feather", quantity: 1 },
        ],
        level: 1,
        quantity: 1,
        skill: "weaponcrafting",
      },
      type: "weapon",
    });
    const getBankItems = vi.fn((query?: { item_code?: string }) => {
      if (query?.item_code === undefined) {
        return okAsync(buildBankItemsPage([{ code: "ash_wood", quantity: 10 }]));
      }
      if (query.item_code === "ash_wood") {
        return okAsync(buildBankItemsPage([{ code: "ash_wood", quantity: 10 }]));
      }
      return okAsync(buildBankItemsPage([]));
    });
    const getItems = vi.fn(() => okAsync(buildItemPage([woodenStaff])));

    const result = await findCraftableFromBankSurplus({ getBankItems, getItems }, character);

    expect(result.isOk() && result.value).toEqual([]);
  });

  it("deduplicates a candidate surfaced by more than one surplus material", async () => {
    const character = buildCharacter([], { weaponcrafting_level: 1 });
    const woodenStaff = buildItem({
      code: "wooden_staff",
      craft: {
        items: [
          { code: "ash_wood", quantity: 2 },
          { code: "copper_ore", quantity: 1 },
        ],
        level: 1,
        quantity: 1,
        skill: "weaponcrafting",
      },
      type: "weapon",
    });
    const getBankItems = vi.fn((query?: { item_code?: string }) => {
      if (query?.item_code === undefined) {
        return okAsync(
          buildBankItemsPage([
            { code: "ash_wood", quantity: 10 },
            { code: "copper_ore", quantity: 10 },
          ]),
        );
      }
      return okAsync(buildBankItemsPage([{ code: query.item_code, quantity: 10 }]));
    });
    const getItems = vi.fn(() => okAsync(buildItemPage([woodenStaff])));

    const result = await findCraftableFromBankSurplus({ getBankItems, getItems }, character);

    expect(getItems).toHaveBeenCalledTimes(2);
    expect(result.isOk() && result.value).toEqual([
      { craftableQuantity: 5, itemCode: "wooden_staff", skill: "weaponcrafting" },
    ]);
  });
});
