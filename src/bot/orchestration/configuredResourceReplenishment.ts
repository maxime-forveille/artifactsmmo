import { err, ok, type Result } from "neverthrow";

import type { CrewSnapshot } from "./crewSnapshot.js";
import type { OrchestratorState } from "./orchestratorState.js";
import {
  planResourceReplenishment,
  type Resource,
  type ResourceReplenishmentError,
  type ResourceReplenishmentPlan,
} from "./resourceReplenishment.js";

export type ResolvedGoalResource = Readonly<{
  goalId: string;
  resource: Resource;
}>;

export class GoalResourceNotResolvedError extends Error {
  constructor(public readonly goalId: string) {
    super(`No resource was resolved for Goal "${goalId}"`);
    this.name = "GoalResourceNotResolvedError";
  }
}

export type ConfiguredResourceReplenishmentError =
  | GoalResourceNotResolvedError
  | ResourceReplenishmentError;

export type ConfiguredResourceReplenishmentPlanner = (
  snapshot: CrewSnapshot,
  state: OrchestratorState,
) => Result<ResourceReplenishmentPlan, ConfiguredResourceReplenishmentError>;

/**
 * Plans the highest-priority unresolved bank Goal. Goals already satisfied by
 * the same snapshot are removed until useful work is found or no Goals remain.
 */
export const createConfiguredResourceReplenishmentPlanner = (
  resolvedResources: readonly ResolvedGoalResource[],
): ConfiguredResourceReplenishmentPlanner => {
  const resourcesByGoalId = new Map(
    resolvedResources.map(({ goalId, resource }) => [goalId, resource]),
  );

  return (snapshot, state) => {
    let nextState = state;

    for (;;) {
      const goal = nextState.goals[0];

      if (goal === undefined) {
        return ok({ activities: [], state: nextState });
      }

      const resource = resourcesByGoalId.get(goal.id);

      if (resource === undefined) {
        return err(new GoalResourceNotResolvedError(goal.id));
      }

      const planned = planResourceReplenishment(snapshot, nextState, resource);

      if (planned.isErr()) {
        return err(planned.error);
      }

      const didCompleteGoal = planned.value.state.goals.length < nextState.goals.length;

      if (!didCompleteGoal) {
        return ok(planned.value);
      }

      nextState = planned.value.state;
    }
  };
};
