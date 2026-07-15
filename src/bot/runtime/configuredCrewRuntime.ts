import { ResultAsync } from "neverthrow";

import {
  createConfiguredResourceReplenishmentPlanner,
  type ConfiguredResourceReplenishmentError,
  type ResolvedGoalResource,
} from "../orchestration/configuredResourceReplenishment.js";
import { createCrewRuntime, type CrewRuntimeStartError } from "./crewRuntime.js";
import type { RollingActivityCoordinator } from "./rollingActivityCoordinator.js";
import { type ArtifactsApiError, type ArtifactsClient } from "../../client/index.js";
import {
  buildInitialOrchestratorState,
  type OrchestrationConfig,
} from "../../utils/orchestrationConfig.js";

type ConfiguredCrewRuntimeOptions = Readonly<{
  config: OrchestrationConfig;
  reportError: (error: unknown) => void;
  waitBeforeRetry: () => Promise<void>;
}>;

export const resolveConfiguredResources = (
  client: Pick<ArtifactsClient, "getResource">,
  config: OrchestrationConfig,
): ResultAsync<readonly ResolvedGoalResource[], ArtifactsApiError> =>
  ResultAsync.combine(
    config.goals.map((goal) =>
      client.getResource(goal.resourceCode).map((response) => ({
        goalId: goal.id,
        resource: response.data,
      })),
    ),
  );

/** Resolves configured catalog resources before creating the live crew runtime. */
export const createConfiguredCrewRuntime = (
  client: ArtifactsClient,
  options: ConfiguredCrewRuntimeOptions,
): ResultAsync<
  RollingActivityCoordinator<ConfiguredResourceReplenishmentError, CrewRuntimeStartError>,
  ArtifactsApiError
> =>
  resolveConfiguredResources(client, options.config).andThen((resolvedResources) =>
    createCrewRuntime(client, {
      initialState: buildInitialOrchestratorState(options.config),
      plan: createConfiguredResourceReplenishmentPlanner(resolvedResources),
      reportError: options.reportError,
      waitBeforeRetry: options.waitBeforeRetry,
    }),
  );
