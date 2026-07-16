import { ResultAsync } from "neverthrow";

import {
  createConfiguredGoalPlanner,
  type ConfiguredGoalPlannerError,
  type ResolvedGoalItem,
  type ResolvedGoalMaterialSource,
  type ResolvedGoalResource,
} from "../orchestration/configuredGoalPlanner.js";
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

export const resolveConfiguredItems = (
  client: Pick<ArtifactsClient, "getItem">,
  config: OrchestrationConfig,
): ResultAsync<readonly ResolvedGoalItem[], ArtifactsApiError> =>
  ResultAsync.combine(
    config.goals.flatMap((goal) =>
      goal.type === "equipItem"
        ? [
            client.getItem(goal.itemCode).map((response) => ({
              goalId: goal.id,
              item: response.data,
            })),
          ]
        : [],
    ),
  );

export const resolveEquipmentMaterialSources = (
  client: Pick<ArtifactsClient, "getMonsters" | "getResources">,
  resolvedItems: readonly ResolvedGoalItem[],
): ResultAsync<readonly ResolvedGoalMaterialSource[], ArtifactsApiError> =>
  ResultAsync.combine(
    resolvedItems.flatMap(({ goalId, item }) =>
      [...new Set((item.craft?.items ?? []).map((material) => material.code))].map((itemCode) =>
        ResultAsync.combine([
          client.getMonsters({ drop: itemCode, size: 100 }),
          client.getResources({ drop: itemCode, size: 100 }),
        ]).map(([monsters, resources]): ResolvedGoalMaterialSource | undefined => {
          if (monsters.data.length + resources.data.length !== 1) {
            return undefined;
          }

          const [monster] = monsters.data;

          if (monster !== undefined) {
            return {
              goalId,
              materialSource: {
                itemCode,
                source: { monster, type: "hunt" },
              },
            };
          }

          const [resource] = resources.data;

          return resource === undefined
            ? undefined
            : {
                goalId,
                materialSource: {
                  itemCode,
                  source: { resource, type: "gather" },
                },
              };
        }),
      ),
    ),
  ).map((sources) => sources.filter((source) => source !== undefined));

export const resolveConfiguredResources = (
  client: Pick<ArtifactsClient, "getResource">,
  config: OrchestrationConfig,
): ResultAsync<readonly ResolvedGoalResource[], ArtifactsApiError> =>
  ResultAsync.combine(
    config.goals.flatMap((goal) =>
      goal.type === "replenishBankItem"
        ? [
            client.getResource(goal.resourceCode).map((response) => ({
              goalId: goal.id,
              resource: response.data,
            })),
          ]
        : [],
    ),
  );

/** Resolves configured catalog targets before creating the live crew runtime. */
export const createConfiguredCrewRuntime = (
  client: ArtifactsClient,
  options: ConfiguredCrewRuntimeOptions,
): ResultAsync<
  RollingActivityCoordinator<ConfiguredGoalPlannerError, CrewRuntimeStartError>,
  ArtifactsApiError
> =>
  resolveConfiguredItems(client, options.config).andThen((resolvedItems) =>
    ResultAsync.combine([
      resolveConfiguredResources(client, options.config),
      resolveEquipmentMaterialSources(client, resolvedItems),
    ]).andThen(([resolvedResources, resolvedMaterialSources]) =>
      createCrewRuntime(client, {
        initialState: buildInitialOrchestratorState(options.config),
        plan: createConfiguredGoalPlanner(
          resolvedItems,
          resolvedResources,
          resolvedMaterialSources,
        ),
        reportError: options.reportError,
        waitBeforeRetry: options.waitBeforeRetry,
      }),
    ),
  );
