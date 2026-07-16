import { ok } from 'neverthrow';

import type {
  DurableOrchestratorState,
  OrchestratorStateRepository,
} from '../bot/orchestration/orchestratorStateRepository.js';

const cloneState = <TState extends DurableOrchestratorState | undefined>(
  state: TState,
): TState => structuredClone(state);

export const createInMemoryOrchestratorStateRepository = (
  initialState?: DurableOrchestratorState,
): OrchestratorStateRepository<never> => {
  let persistedState = cloneState(initialState);

  return {
    load: () => ok(cloneState(persistedState)),
    save: (state) => {
      persistedState = cloneState(state);
      return ok(undefined);
    },
  };
};
