import type { ResultAsync } from "neverthrow";

import type { ArtifactsApiError, ArtifactsClient } from "../client/index.js";
import type { components } from "../client/schema.js";
import { isSafeToFight } from "./combat.js";

type Character = components["schemas"]["CharacterSchema"];
type Monster = components["schemas"]["MonsterSchema"];

type ProgressionClient = Pick<ArtifactsClient, "getMonsters">;

/**
 * Finds the best monster to hunt next for `character`: the highest-level
 * monster (a decent proxy for "most XP/loot" until there's a real
 * per-action rate estimate - see the README's roadmap) that `isSafeToFight`
 * still considers safe, among monsters up to the character's own level.
 * Returns `undefined` if nothing qualifies (e.g. even the weakest monster
 * available isn't safe with the character's current gear) - callers should
 * treat that as a signal to look at upgrading equipment instead.
 */
export const findNextSafeMonster = (
  client: ProgressionClient,
  character: Character,
): ResultAsync<Monster | undefined, ArtifactsApiError> =>
  client
    .getMonsters({ max_level: character.level })
    .map((page) =>
      page.data
        .filter((monster) => isSafeToFight(character, monster))
        .reduce<Monster | undefined>(
          (best, candidate) =>
            best === undefined || candidate.level > best.level ? candidate : best,
          undefined,
        ),
    );
