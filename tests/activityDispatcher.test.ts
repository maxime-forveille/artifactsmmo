import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { runActivity } from "../src/bot/runtime/activityDispatcher.js";
import type { components } from "../src/client/schema.js";

type Character = components["schemas"]["CharacterSchema"];
type Cooldown = components["schemas"]["CooldownSchema"];
type Map = components["schemas"]["MapSchema"];
type MapPage = components["schemas"]["StaticDataPage_MapSchema_"];
type MapQuery = { content_code?: string; content_type?: string };

const TARGET_MAP_ID = 277;
const BANK_MAP_ID = 334;

const buildCharacter = (): Character => ({
  ...({} as Character),
  hp: 100,
  inventory: [{ code: "loot", quantity: 20, slot: 1 }],
  inventory_max_items: 20,
  max_hp: 100,
  name: "Stan",
});

const buildCooldown = (): Cooldown => ({
  expiration: "2026-07-15T12:00:05.000Z",
  reason: "deposit_item",
  remaining_seconds: 5,
  started_at: "2026-07-15T12:00:00.000Z",
  total_seconds: 5,
});

const buildMap = (mapId: number): Map => ({ ...({} as Map), map_id: mapId });

const buildPage = (mapId: number): MapPage => ({
  data: [buildMap(mapId)],
  page: 1,
  pages: 1,
  size: 50,
  total: 1,
});

const buildDependencies = () => {
  const character = buildCharacter();
  const getMaps = vi.fn((query: MapQuery = {}) =>
    okAsync(buildPage(query.content_type === "bank" ? BANK_MAP_ID : TARGET_MAP_ID)),
  );

  return {
    agent: {
      depositItems: vi.fn(() =>
        okAsync({ bank: [], character, cooldown: buildCooldown(), items: [] }),
      ),
      fight: vi.fn(),
      gather: vi.fn(),
      getCharacter: vi.fn(() => character),
      moveTo: vi.fn(() => okAsync(undefined)),
      rest: vi.fn(),
    },
    client: { getMaps },
    getMaps,
  };
};

describe("runActivity", () => {
  it("dispatches farmResource to one farming cycle with the resource code", async () => {
    const { agent, client, getMaps } = buildDependencies();

    const result = await runActivity(client, agent, {
      resourceCode: "copper_rocks",
      type: "farmResource",
    });

    expect(result.isOk()).toBe(true);
    expect(getMaps).toHaveBeenNthCalledWith(1, {
      content_code: "copper_rocks",
      content_type: "resource",
    });
    expect(agent.gather).not.toHaveBeenCalled();
    expect(agent.fight).not.toHaveBeenCalled();
  });

  it("dispatches huntMonster to one hunting cycle with the monster code", async () => {
    const { agent, client, getMaps } = buildDependencies();

    const result = await runActivity(client, agent, {
      monsterCode: "yellow_slime",
      type: "huntMonster",
    });

    expect(result.isOk()).toBe(true);
    expect(getMaps).toHaveBeenNthCalledWith(1, {
      content_code: "yellow_slime",
      content_type: "monster",
    });
    expect(agent.fight).not.toHaveBeenCalled();
    expect(agent.gather).not.toHaveBeenCalled();
  });
});
