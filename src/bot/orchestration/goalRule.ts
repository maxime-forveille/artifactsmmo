export const GOAL_RULE_NAMES = [
  'equipmentUpgrade',
  'combatProgression',
  'professionProgression',
  'gatheringProgression',
  'bankReplenishment',
  'bankSurplusProcessing',
] as const;

export type GoalRuleName = (typeof GOAL_RULE_NAMES)[number];
