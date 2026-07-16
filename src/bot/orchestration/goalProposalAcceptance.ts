import { err, ok, type Result } from 'neverthrow';

import { areGoalsEquivalent, type GoalProposal } from './goalPolicy.js';
import type { ActiveGoal, OrchestratorState } from './orchestratorState.js';

export class GoalProposalParentNotFoundError extends Error {
  constructor(
    public readonly goalId: string,
    public readonly parentGoalId: string,
  ) {
    super(
      `Cannot accept Goal "${goalId}": parent Goal "${parentGoalId}" does not exist`,
    );
    this.name = 'GoalProposalParentNotFoundError';
  }
}

const activeGoalFromProposal = (proposal: GoalProposal): ActiveGoal =>
  proposal.parentGoalId === undefined
    ? {
        ...proposal.goal,
        origin: 'autonomous',
        reason: proposal.reason,
        rule: proposal.rule,
      }
    : {
        ...proposal.goal,
        origin: 'prerequisite',
        parentGoalId: proposal.parentGoalId,
        reason: proposal.reason,
        rule: proposal.rule,
      };

const acceptGoalProposal = (
  state: OrchestratorState,
  proposal: GoalProposal,
): Result<OrchestratorState, GoalProposalParentNotFoundError> => {
  if (state.goals.some((goal) => areGoalsEquivalent(goal, proposal.goal))) {
    return ok(state);
  }

  const activeGoal = activeGoalFromProposal(proposal);

  if (proposal.parentGoalId === undefined) {
    return ok({ ...state, goals: [...state.goals, activeGoal] });
  }

  const parentIndex = state.goals.findIndex(
    (goal) => goal.id === proposal.parentGoalId,
  );

  if (parentIndex === -1) {
    return err(
      new GoalProposalParentNotFoundError(
        proposal.goal.id,
        proposal.parentGoalId,
      ),
    );
  }

  return ok({
    ...state,
    goals: state.goals.toSpliced(parentIndex, 0, activeGoal),
  });
};

/** Persists selected Goals while preserving existing priority and parent Goals. */
export const acceptGoalProposals = (
  state: OrchestratorState,
  proposals: readonly GoalProposal[],
): Result<OrchestratorState, GoalProposalParentNotFoundError> =>
  proposals.reduce<Result<OrchestratorState, GoalProposalParentNotFoundError>>(
    (result, proposal) =>
      result.andThen((nextState) => acceptGoalProposal(nextState, proposal)),
    ok(state),
  );
