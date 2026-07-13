import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import type { ArtifactsApiError, ArtifactsClient } from "../client/index.js";
import type { components } from "../client/schema.js";
import { heldQuantity } from "./inventory.js";
import {
  findMonsterForDrop,
  findResourceForDrop,
  MonsterNotFoundError,
  ResourceNotFoundError,
} from "./world.js";

type Character = components["schemas"]["CharacterSchema"];
type Item = components["schemas"]["ItemSchema"];

type MaterialPlanClient = Pick<
  ArtifactsClient,
  "getBankItems" | "getItem" | "getMonsters" | "getResources"
>;

/** Where a still-missing raw material could come from, if anywhere known. */
export type MaterialSource =
  | { readonly type: "gather"; readonly resourceCode: string }
  | { readonly type: "hunt"; readonly monsterCode: string }
  | { readonly type: "unknown" };

/**
 * A raw material this character doesn't currently have enough of (counting
 * both inventory and bank), and where it could come from. Only leaf
 * (non-craftable) materials show up here - an intermediate item that's
 * itself missing but craftable is represented by its own ingredients
 * instead, same as `ensureHeldItem`'s recursion in `strategies/equipment.ts`.
 */
export type MissingMaterial = {
  readonly itemCode: string;
  readonly missingQuantity: number;
  readonly source: MaterialSource;
};

/** How many units of `itemCode` are sitting in the bank right now. */
const bankQuantity = (
  client: Pick<MaterialPlanClient, "getBankItems">,
  itemCode: string,
): ResultAsync<number, ArtifactsApiError> =>
  client.getBankItems({ item_code: itemCode }).map((page) => page.data[0]?.quantity ?? 0);

/**
 * Classifies a raw (non-craftable) material by where it could be obtained:
 * a gatherable resource node, a monster drop, or - unlike
 * `ensureHeldItem`, which fails outright - `"unknown"` when neither exists,
 * so a decision layer can skip/deprioritize an unobtainable material
 * instead of the whole computation failing. A genuine API error is still
 * propagated, only the "not found" cases are downgraded to `"unknown"`.
 */
const sourceFor = (
  client: Pick<MaterialPlanClient, "getMonsters" | "getResources">,
  itemCode: string,
): ResultAsync<MaterialSource, ArtifactsApiError> =>
  findResourceForDrop(client, itemCode)
    .map((resource): MaterialSource => ({ resourceCode: resource.code, type: "gather" }))
    .orElse((error) =>
      error instanceof ResourceNotFoundError
        ? findMonsterForDrop(client, itemCode)
            .map((monster): MaterialSource => ({ monsterCode: monster.code, type: "hunt" }))
            .orElse((huntError) =>
              huntError instanceof MonsterNotFoundError
                ? okAsync<MaterialSource, ArtifactsApiError>({ type: "unknown" })
                : errAsync(huntError),
            )
        : errAsync(error),
    );

/**
 * Same as `materialsNeededFor`, but for when the item's data has already
 * been fetched (mirrors `ensureHeldItem`'s split in `strategies/equipment.ts`
 * for the same reason: avoid a redundant `getItem` round-trip when a caller
 * already has it, e.g. while recursing into craft materials).
 */
const materialsNeededForItem = (
  client: MaterialPlanClient,
  character: Character,
  item: Item,
  quantity: number,
): ResultAsync<readonly MissingMaterial[], ArtifactsApiError> => {
  const itemCode = item.code;
  const held = heldQuantity(character, itemCode);

  if (held >= quantity) {
    return okAsync([]);
  }

  return bankQuantity(client, itemCode).andThen((banked) => {
    const stillMissing = quantity - held - banked;

    if (stillMissing <= 0) {
      return okAsync([]);
    }

    if (item.craft?.skill !== undefined) {
      const craftYield = item.craft.quantity ?? 1;
      const craftsNeeded = Math.ceil(stillMissing / craftYield);
      const materials = item.craft.items ?? [];

      return materials.reduce<ResultAsync<readonly MissingMaterial[], ArtifactsApiError>>(
        (acc, material) =>
          acc.andThen((soFar) =>
            materialsNeededFor(
              client,
              character,
              material.code,
              material.quantity * craftsNeeded,
            ).map((subMaterials) => [...soFar, ...subMaterials]),
          ),
        okAsync([]),
      );
    }

    return sourceFor(client, itemCode).map((source) => [
      { itemCode, missingQuantity: stillMissing, source },
    ]);
  });
};

/**
 * Read-only, side-effect-free version of `ensureHeldItem`
 * (`strategies/equipment.ts`): reports what's still missing to reach
 * `quantity` of `itemCode`, recursing into craft materials exactly the same
 * way, but never moves the character, withdraws from the bank, gathers,
 * hunts, or crafts anything. Meant for a future decision layer to compare
 * "how much work is this upgrade" across candidates before committing to
 * one - see the README's "Automated progression decisions" section.
 *
 * Known simplifications versus the real (acting) pipeline:
 *  - Doesn't account for an item already equipped in some slot the way
 *    `reclaimEquippedIfAvailable` does - an equipped copy isn't counted as
 *    "held".
 *  - Each recursive branch checks the bank independently, so if two
 *    different craft branches both need the same shared material, the
 *    bank's current quantity is considered available to both rather than
 *    split between them. The real pipeline doesn't have this issue because
 *    withdrawals happen sequentially and actually deplete the bank. This is
 *    fine for a "how much is missing, roughly" estimate; it isn't safe to
 *    read as several independent guarantees, since acting on all of them at
 *    once could double-count what's actually available.
 */
export const materialsNeededFor = (
  client: MaterialPlanClient,
  character: Character,
  itemCode: string,
  quantity: number,
): ResultAsync<readonly MissingMaterial[], ArtifactsApiError> =>
  heldQuantity(character, itemCode) >= quantity
    ? okAsync([])
    : client
        .getItem(itemCode)
        .andThen((response) => materialsNeededForItem(client, character, response.data, quantity));
