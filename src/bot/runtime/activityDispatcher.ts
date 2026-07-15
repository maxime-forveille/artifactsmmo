import type { ResultAsync } from "neverthrow";

import type { ArtifactsClient } from "../../client/index.js";
import type { FarmResourceActivity, HuntMonsterActivity } from "../activities/activity.js";
import type { FarmingError } from "../activities/farming.js";
import { runFarmingCycle } from "../activities/farming.js";
import type { HuntingError } from "../activities/hunting.js";
import { runHuntingCycle } from "../activities/hunting.js";
import type { CharacterAgent } from "./characterAgent.js";

export type ExecutableActivity = FarmResourceActivity | HuntMonsterActivity;
export type ActivityExecutionError = FarmingError | HuntingError;

type ActivityClient = Pick<ArtifactsClient, "getMaps">;
type ActivityAgent = Pick<
  CharacterAgent,
  "depositItems" | "fight" | "gather" | "getCharacter" | "moveTo" | "rest"
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
): ResultAsync<void, ActivityExecutionError> =>
  activity.type === "farmResource"
    ? runFarmingCycle(client, agent, activity.resourceCode)
    : runHuntingCycle(client, agent, activity.monsterCode);
