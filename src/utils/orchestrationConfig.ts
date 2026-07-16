import { readFileSync } from 'node:fs';
import * as v from 'valibot';

import {
  GOAL_RULE_NAMES,
  type GoalRuleName,
} from '../bot/orchestration/goalPolicy.js';
import type { OrchestratorState } from '../bot/orchestration/orchestratorState.js';

const nonEmptyString = v.pipe(v.string(), v.minLength(1));

const configuredGoalSchema = v.variant('type', [
  v.strictObject({
    characterName: nonEmptyString,
    id: nonEmptyString,
    itemCode: nonEmptyString,
    type: v.literal('equipItem'),
  }),
  v.strictObject({
    id: nonEmptyString,
    itemCode: nonEmptyString,
    minimumBankQuantity: v.pipe(v.number(), v.integer(), v.minValue(1)),
    resourceCode: nonEmptyString,
    type: v.literal('replenishBankItem'),
  }),
]);

const goalRuleOrderSchema = v.pipe(
  v.array(v.picklist(GOAL_RULE_NAMES)),
  v.check(
    (goalRuleOrder) =>
      goalRuleOrder.length === GOAL_RULE_NAMES.length &&
      new Set<GoalRuleName>(goalRuleOrder).size === GOAL_RULE_NAMES.length,
    'Goal Rule order must contain every supported rule exactly once',
  ),
);

const orchestrationConfigSchema = v.strictObject({
  goals: v.pipe(
    v.array(configuredGoalSchema),
    v.check(
      (goals) => new Set(goals.map((goal) => goal.id)).size === goals.length,
      'Goal ids must be unique',
    ),
  ),
  policy: v.optional(v.strictObject({ goalRuleOrder: goalRuleOrderSchema })),
});

export type OrchestrationConfig = Readonly<
  v.InferOutput<typeof orchestrationConfigSchema>
>;

const formatIssues = (issues: readonly v.BaseIssue<unknown>[]): string =>
  issues
    .map((issue) => `  - ${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`)
    .join('\n');

/** Parses explicit Goals and optional autonomous policy configuration. */
export const parseOrchestrationConfig = (raw: string): OrchestrationConfig => {
  const parsed: unknown = JSON.parse(raw);
  const result = v.safeParse(orchestrationConfigSchema, parsed);

  if (!result.success) {
    throw new Error(
      `Invalid orchestration configuration:\n${formatIssues(result.issues)}`,
    );
  }

  return result.output;
};

/** Converts validated configuration into serializable initial policy state. */
export const buildInitialOrchestratorState = (
  config: OrchestrationConfig,
): OrchestratorState => ({
  goals: config.goals.map((goal) =>
    goal.type === 'equipItem'
      ? {
          characterName: goal.characterName,
          id: goal.id,
          itemCode: goal.itemCode,
          type: goal.type,
        }
      : {
          id: goal.id,
          itemCode: goal.itemCode,
          minimumBankQuantity: goal.minimumBankQuantity,
          type: goal.type,
        },
  ),
  reservations: [],
});

export const loadOrchestrationConfig = (path: string): OrchestrationConfig =>
  parseOrchestrationConfig(readFileSync(path, 'utf-8'));
