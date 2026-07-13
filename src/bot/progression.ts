import type { ResultAsync } from "neverthrow";

import type { ArtifactsApiError, ArtifactsClient } from "../client/index.js";
import type { components } from "../client/schema.js";
import { isSafeToFight } from "./combat.js";
import { type ObservedMonsterRates, observedMonsterXpRatesOrEmpty } from "./xpRates.js";

type Character = components["schemas"]["CharacterSchema"];
type Monster = components["schemas"]["MonsterSchema"];

type ProgressionClient = Pick<ArtifactsClient, "getCharacterLogs" | "getMonsters">;

/** The highest-level monster in `monsters`, or undefined if the list is empty. */
const highestLevel = (monsters: readonly Monster[]): Monster | undefined =>
  monsters.reduce<Monster | undefined>(
    (best, candidate) => (best === undefined || candidate.level > best.level ? candidate : best),
    undefined,
  );

/**
 * The monster in `monsters` with the best observed XP/second rate (see
 * `xpRates.ts`), among those `rates` actually has data for. Returns
 * undefined if none of `monsters` has been fought recently enough to have
 * a rate yet, so callers can fall back to a different heuristic.
 */
const highestObservedRate = (
  monsters: readonly Monster[],
  rates: ObservedMonsterRates,
): Monster | undefined =>
  monsters
    .filter((monster) => rates.has(monster.code))
    .reduce<Monster | undefined>((best, candidate) => {
      if (best === undefined) {
        return candidate;
      }

      return rates.get(candidate.code)! > rates.get(best.code)! ? candidate : best;
    }, undefined);

/**
 * Finds the best monster to hunt next for `character`, among monsters up
 * to their own level that `isSafeToFight` still allows: whichever has the
 * best observed XP/second rate (see `xpRates.ts`) from this character's
 * own recent fight history, or - when none of the safe candidates have
 * been fought recently enough to have a rate yet - the highest-level one,
 * as a reasonable proxy until real data accumulates. Returns `undefined`
 * if nothing qualifies (e.g. even the weakest monster available isn't
 * safe with the character's current gear) - callers should treat that as
 * a signal to look at upgrading equipment instead.
 */
export const findNextSafeMonster = (
  client: ProgressionClient,
  character: Character,
): ResultAsync<Monster | undefined, ArtifactsApiError> =>
  observedMonsterXpRatesOrEmpty(client, character.name).andThen((rates) =>
    client.getMonsters({ max_level: character.level }).map((page) => {
      const safe = page.data.filter((monster) => isSafeToFight(character, monster));

      return highestObservedRate(safe, rates) ?? highestLevel(safe);
    }),
  );
