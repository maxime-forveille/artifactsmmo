import type { ResultAsync } from "neverthrow";

import type { ArtifactsClient } from "../../client/index.js";
import type {
  CraftItemActivity,
  FarmResourceActivity,
  HuntMonsterActivity,
} from "../activities/activity.js";
import { runCraftItemActivity, type CraftItemExecutionError } from "../activities/crafting.js";
import type { FarmingError } from "../activities/farming.js";
import { runFarmingCycle } from "../activities/farming.js";
import type { HuntingError } from "../activities/hunting.js";
import { runHuntingCycle } from "../activities/hunting.js";
import type { CharacterAgent } from "./characterAgent.js";

export type ExecutableActivity = CraftItemActivity | FarmResourceActivity | HuntMonsterActivity;
export type ActivityExecutionError = CraftItemExecutionError | FarmingError | HuntingError;

type ActivityClient = Pick<ArtifactsClient, "getItem" | "getMaps">;
type ActivityAgent = Pick<
  CharacterAgent,
  "craft" | "depositItems" | "fight" | "gather" | "getCharacter" | "moveTo" | "rest"
>;

/**
 * Executes one already-selected bounded Activity with an existing character
 * agent. Scheduling, Reservations, retries, and policy remain outside this
 * dispatcher.
 */
export const runActivity = (
  client: ActivityClient,
  agent: ActivityAgent,
  activity: ExecutableActivity,
): ResultAsync<void, ActivityExecutionError> => {
  switch (activity.type) {
    case "craftItem": {
      return runCraftItemActivity(client, agent, activity);
    }
    case "farmResource": {
      return runFarmingCycle(client, agent, activity.resourceCode);
    }
    case "huntMonster": {
      return runHuntingCycle(client, agent, activity.monsterCode);
    }
  }
};
