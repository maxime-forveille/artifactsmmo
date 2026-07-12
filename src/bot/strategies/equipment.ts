import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import type { ArtifactsApiError, ArtifactsClient } from "../../client/index.js";
import type { components } from "../../client/schema.js";
import { logger } from "../../utils/logger.js";
import type { CharacterAgent } from "../characters/characterAgent.js";
import { heldItems, heldQuantity, isInventoryFull } from "../inventory.js";
import {
  BANK_CONTENT_CODE,
  findResourceForDrop,
  type LocationNotFoundError,
  resolveLocation,
  type ResourceNotFoundError,
} from "../world.js";

type CharacterSnapshot = components["schemas"]["CharacterSchema"];
type EquipSlot = components["schemas"]["ItemSlot"];
type Item = components["schemas"]["ItemSchema"];

export class UnsupportedEquipSlotError extends Error {
  constructor(
    public readonly itemCode: string,
    public readonly itemType: string,
  ) {
    super(`Don't know which equipment slot fits item type "${itemType}" (item "${itemCode}")`);
    this.name = "UnsupportedEquipSlotError";
  }
}

export class InventoryFullError extends Error {
  constructor(public readonly itemCode: string) {
    super(`Inventory is full of "${itemCode}" itself, with nothing else to deposit to make room`);
    this.name = "InventoryFullError";
  }
}

export type EquipmentError =
  | ArtifactsApiError
  | InventoryFullError
  | LocationNotFoundError
  | ResourceNotFoundError
  | UnsupportedEquipSlotError;

type EquipmentClient = Pick<ArtifactsClient, "getItem" | "getMaps" | "getResources">;
type EquipmentAgent = Pick<
  CharacterAgent,
  "craft" | "depositItems" | "equip" | "gather" | "getCharacter" | "moveTo"
>;

// Only the item types produced by the currently craftable level-1 gear.
// Artifacts/utilities have multiple slots and aren't handled (yet).
const EQUIP_SLOT_BY_ITEM_TYPE: Partial<Record<string, EquipSlot>> = {
  amulet: "amulet",
  bag: "bag",
  body_armor: "body_armor",
  boots: "boots",
  helmet: "helmet",
  leg_armor: "leg_armor",
  ring: "ring1",
  rune: "rune",
  shield: "shield",
  weapon: "weapon",
};

// Only the slots `EQUIP_SLOT_BY_ITEM_TYPE` can produce; the rest of the
// `EquipSlot` enum (ring2, artifact1-3, utility1-2) is unused here.
const SLOT_FIELD: Partial<Record<EquipSlot, keyof CharacterSnapshot>> = {
  amulet: "amulet_slot",
  bag: "bag_slot",
  body_armor: "body_armor_slot",
  boots: "boots_slot",
  helmet: "helmet_slot",
  leg_armor: "leg_armor_slot",
  ring1: "ring1_slot",
  rune: "rune_slot",
  shield: "shield_slot",
  weapon: "weapon_slot",
};

/** Whether `slot` already holds any item (not necessarily `itemCode`). */
const isSlotFilled = (character: CharacterSnapshot, slot: EquipSlot): boolean => {
  const field = SLOT_FIELD[slot];
  return field !== undefined && Boolean(character[field]);
};

/**
 * Deposits everything except `itemCode` at the bank, then returns to
 * `resourceMapId`, freeing up inventory room without losing progress on the
 * item currently being gathered. Fails with `InventoryFullError` if
 * `itemCode` itself is the only thing held (nothing safe to drop).
 */
const makeRoomForGathering = (
  client: EquipmentClient,
  agent: Pick<EquipmentAgent, "depositItems" | "getCharacter" | "moveTo">,
  itemCode: string,
  resourceMapId: number,
): ResultAsync<void, EquipmentError> => {
  const character = agent.getCharacter();
  const itemsToDeposit = heldItems(character).filter((item) => item.code !== itemCode);

  if (itemsToDeposit.length === 0) {
    return errAsync(new InventoryFullError(itemCode));
  }

  logger.info(
    { character: character.name, items: itemsToDeposit },
    `${character.name}: inventory full, depositing ${itemsToDeposit.length} item type(s) at the bank before continuing to gather ${itemCode}`,
  );

  return resolveLocation(client, "bank", BANK_CONTENT_CODE)
    .andThen((bankMap) => agent.moveTo(bankMap.map_id))
    .andThen(() => agent.depositItems(itemsToDeposit))
    .andThen(() => agent.moveTo(resourceMapId))
    .map(() => undefined);
};

const gatherUntilHave = (
  client: EquipmentClient,
  agent: Pick<EquipmentAgent, "depositItems" | "gather" | "getCharacter" | "moveTo">,
  itemCode: string,
  targetQuantity: number,
  resourceMapId: number,
): ResultAsync<void, EquipmentError> => {
  const character = agent.getCharacter();

  if (heldQuantity(character, itemCode) >= targetQuantity) {
    return okAsync(undefined);
  }

  if (isInventoryFull(character)) {
    return makeRoomForGathering(client, agent, itemCode, resourceMapId).andThen(() =>
      gatherUntilHave(client, agent, itemCode, targetQuantity, resourceMapId),
    );
  }

  return agent
    .gather()
    .andThen(() => gatherUntilHave(client, agent, itemCode, targetQuantity, resourceMapId));
};

/**
 * Same as `ensureHeld`, but for when the item's data has already been
 * fetched (e.g. by the caller, to avoid an extra `getItem` round-trip for
 * the same code).
 */
const ensureHeldItem = (
  client: EquipmentClient,
  agent: EquipmentAgent,
  item: Item,
  quantity: number,
): ResultAsync<void, EquipmentError> => {
  const itemCode = item.code;
  const held = heldQuantity(agent.getCharacter(), itemCode);

  if (held >= quantity) {
    return okAsync(undefined);
  }

  const missing = quantity - held;

  if (item.craft?.skill !== undefined) {
    const craftSkill = item.craft.skill;
    const craftYield = item.craft.quantity ?? 1;
    const craftsNeeded = Math.ceil(missing / craftYield);
    const materials = item.craft.items ?? [];

    return materials
      .reduce<ResultAsync<void, EquipmentError>>(
        (acc, material) =>
          acc.andThen(() =>
            ensureHeld(client, agent, material.code, material.quantity * craftsNeeded),
          ),
        okAsync(undefined),
      )
      .andThen(() => resolveLocation(client, "workshop", craftSkill))
      .andThen((workshopMap) => agent.moveTo(workshopMap.map_id))
      .andThen(() => {
        logger.info(
          { character: agent.getCharacter().name, item: itemCode, quantity: craftsNeeded },
          `${agent.getCharacter().name}: crafting ${craftsNeeded}x ${itemCode}`,
        );
        return agent.craft(itemCode, craftsNeeded);
      })
      .map(() => undefined);
  }

  return findResourceForDrop(client, itemCode)
    .andThen((resource) => resolveLocation(client, "resource", resource.code))
    .andThen((resourceMap) =>
      agent
        .moveTo(resourceMap.map_id)
        .andThen(() => gatherUntilHave(client, agent, itemCode, quantity, resourceMap.map_id)),
    );
};

/**
 * Makes sure the character holds at least `quantity` of `itemCode`,
 * gathering and/or crafting whatever is missing:
 *  - if the item has a craft recipe, recursively ensures each material
 *    first, then crafts enough copies at the matching workshop.
 *  - otherwise, treats it as a raw resource drop: finds which resource node
 *    produces it, moves there, and gathers until enough is held.
 */
const ensureHeld = (
  client: EquipmentClient,
  agent: EquipmentAgent,
  itemCode: string,
  quantity: number,
): ResultAsync<void, EquipmentError> =>
  heldQuantity(agent.getCharacter(), itemCode) >= quantity
    ? okAsync(undefined)
    : client
        .getItem(itemCode)
        .andThen((response) => ensureHeldItem(client, agent, response.data, quantity));

/**
 * Crafts `itemCode` (gathering/crafting whatever materials are missing
 * along the way) and equips it in the slot matching its item type.
 */
export const craftAndEquip = (
  client: EquipmentClient,
  agent: EquipmentAgent,
  itemCode: string,
): ResultAsync<void, EquipmentError> =>
  client.getItem(itemCode).andThen((response) => {
    const item = response.data;
    const slot = EQUIP_SLOT_BY_ITEM_TYPE[item.type];

    if (slot === undefined) {
      return errAsync(new UnsupportedEquipSlotError(itemCode, item.type));
    }

    if (isSlotFilled(agent.getCharacter(), slot)) {
      logger.info(
        { character: agent.getCharacter().name, item: itemCode, slot },
        `${agent.getCharacter().name}: ${slot} already equipped, skipping ${itemCode}`,
      );
      return okAsync(undefined);
    }

    return ensureHeldItem(client, agent, item, 1).andThen(() => {
      logger.info(
        { character: agent.getCharacter().name, item: itemCode, slot },
        `${agent.getCharacter().name}: equipping ${itemCode} in ${slot}`,
      );
      return agent.equip([{ code: itemCode, quantity: 1, slot }]).map(() => undefined);
    });
  });
