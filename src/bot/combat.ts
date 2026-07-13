import { okAsync, type ResultAsync } from "neverthrow";

import type { ArtifactsApiError } from "../client/index.js";
import { logger } from "../utils/logger.js";
import type { CharacterAgent } from "./characters/characterAgent.js";

type CombatAgent = Pick<CharacterAgent, "fight" | "getCharacter" | "rest">;
type FightOutcome =
  ReturnType<CombatAgent["fight"]> extends ResultAsync<infer T, unknown> ? T : never;

// Rest once HP drops below this fraction of max HP, so a string of unlucky
// fights doesn't risk the character going down before it gets a chance to
// heal between actions.
const REST_THRESHOLD_RATIO = 0.5;

const restIfLow = (
  agent: Pick<CombatAgent, "getCharacter" | "rest">,
): ResultAsync<void, ArtifactsApiError> => {
  const character = agent.getCharacter();

  if (character.hp >= character.max_hp * REST_THRESHOLD_RATIO) {
    return okAsync(undefined);
  }

  logger.info(
    { character: character.name, hp: character.hp, maxHp: character.max_hp },
    `${character.name}: HP low, resting before continuing to fight`,
  );

  return agent.rest().map(() => undefined);
};

/**
 * Rests first if HP is below half, then fights once (no participants -
 * solo fights only), logging a warning if the fight is lost. Callers
 * decide what "done" means (inventory full, enough of an item held, ...)
 * and loop accordingly.
 */
export const fightSafely = (agent: CombatAgent): ResultAsync<FightOutcome, ArtifactsApiError> =>
  restIfLow(agent)
    .andThen(() => agent.fight())
    .map((result) => {
      if (result.fight.result === "loss") {
        logger.warn(
          { character: agent.getCharacter().name, opponent: result.fight.opponent },
          `${agent.getCharacter().name}: lost a fight against ${result.fight.opponent}`,
        );
      }

      return result;
    });
