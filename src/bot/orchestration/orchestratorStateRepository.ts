import type { Result } from 'neverthrow';

import type { ActiveGoal, OrchestratorState } from './orchestratorState.js';

export type DurableOrchestratorState = Readonly<{
  goals: readonly ActiveGoal[];
}>;

export type OrchestratorStateRepository<E extends Error = Error> = Readonly<{
  load: () => Result<DurableOrchestratorState | undefined, E>;
  save: (state: DurableOrchestratorState) => Result<void, E>;
}>;

/** Selects only restart-safe state; Reservations are process-local. */
export const durableStateFrom = (
  state: OrchestratorState,
): DurableOrchestratorState => ({ goals: state.goals });

/** Restores durable Goals while always starting with no active Reservations. */
export const restoreOrchestratorState = (
  durableState: DurableOrchestratorState | undefined,
  fallbackGoals: readonly ActiveGoal[] = [],
): OrchestratorState => ({
  goals: durableState?.goals ?? fallbackGoals,
  reservations: [],
});
