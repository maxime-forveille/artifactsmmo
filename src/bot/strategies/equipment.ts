import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import type { ArtifactsApiError, ArtifactsClient } from "../../client/index.js";
import type { components } from "../../client/schema.js";
import { logger } from "../../utils/logger.js";
import type { CharacterAgent } from "../characters/characterAgent.js";
import {
  findResourceForDrop,
  type LocationNotFoundError,
  resolveLocation,
  type ResourceNotFoundError,
} from "../world.js";

type CharacterSnapshot = components["schemas"]["CharacterSchema"];
type EquipSlot = components["schemas"]["ItemSlot"];

export class UnsupportedEquipSlotError extends Error {
  constructor(
    public readonly itemCode: string,
    public readonly itemType: string,
  ) {
    super(`Don't know which equipment slot fits item type "${itemType}" (item "${itemCode}")`);
    this.name = "UnsupportedEquipSlotError";
  }
}

export type EquipmentError =
  | ArtifactsApiError
  | LocationNotFoundError
  | ResourceNotFoundError
  | UnsupportedEquipSlotError;

type EquipmentClient = Pick<ArtifactsClient, "getItem" | "getMaps" | "getResources">;
type EquipmentAgent = Pick<
  CharacterAgent,
  "craft" | "equip" | "gather" | "getCharacter" | "moveTo"
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

const heldQuantity = (character: CharacterSnapshot, itemCode: string): number =>
  (character.inventory ?? [])
    .filter((slot) => slot.code === itemCode)
    .reduce((total, slot) => total + slot.quantity, 0);

const gatherUntilHave = (
  agent: Pick<EquipmentAgent, "gather" | "getCharacter">,
  itemCode: string,
  targetQuantity: number,
): ResultAsync<void, ArtifactsApiError> =>
  heldQuantity(agent.getCharacter(), itemCode) >= targetQuantity
    ? okAsync(undefined)
    : agent.gather().andThen(() => gatherUntilHave(agent, itemCode, targetQuantity));

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
): ResultAsync<void, EquipmentError> => {
  const held = heldQuantity(agent.getCharacter(), itemCode);

  if (held >= quantity) {
    return okAsync(undefined);
  }

  const missing = quantity - held;

  return client.getItem(itemCode).andThen((response) => {
    const item = response.data;

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
      .andThen((resourceMap) => agent.moveTo(resourceMap.map_id))
      .andThen(() => gatherUntilHave(agent, itemCode, quantity));
  });
};

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

    return ensureHeld(client, agent, itemCode, 1).andThen(() => {
      logger.info(
        { character: agent.getCharacter().name, item: itemCode, slot },
        `${agent.getCharacter().name}: equipping ${itemCode} in ${slot}`,
      );
      return agent.equip([{ code: itemCode, quantity: 1, slot }]).map(() => undefined);
    });
  });
