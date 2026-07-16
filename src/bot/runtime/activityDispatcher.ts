import type { ResultAsync } from 'neverthrow';

import type { ArtifactsClient } from '../../client/index.js';
import type {
  CraftItemActivity,
  DepositItemActivity,
  EquipItemActivity,
  FarmResourceActivity,
  FightMonsterActivity,
  WithdrawItemActivity,
} from '../activities/activity.js';
import {
  runDepositItemActivity,
  runWithdrawItemActivity,
  type DepositItemError,
  type WithdrawItemError,
} from '../activities/banking.js';
import {
  runCraftItemActivity,
  type CraftItemExecutionError,
} from '../activities/crafting.js';
import {
  runEquipItemActivity,
  type EquipItemExecutionError,
} from '../activities/equipping.js';
import type { FarmingError } from '../activities/farming.js';
import { runFarmingCycle } from '../activities/farming.js';
import type { HuntingError } from '../activities/hunting.js';
import { runHuntingCycle } from '../activities/hunting.js';

import type { CharacterAgent } from './characterAgent.js';

export type ExecutableActivity =
  | CraftItemActivity
  | DepositItemActivity
  | EquipItemActivity
  | FarmResourceActivity
  | FightMonsterActivity
  | WithdrawItemActivity;
export type ActivityExecutionError =
  | CraftItemExecutionError
  | DepositItemError
  | EquipItemExecutionError
  | FarmingError
  | HuntingError
  | WithdrawItemError;

type ActivityClient = Pick<
  ArtifactsClient,
  'getBankItems' | 'getItem' | 'getMaps'
>;
type ActivityAgent = Pick<
  CharacterAgent,
  | 'craft'
  | 'depositItems'
  | 'equip'
  | 'fight'
  | 'gather'
  | 'getCharacter'
  | 'moveTo'
  | 'rest'
  | 'unequip'
  | 'withdrawItems'
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
    case 'craftItem': {
      return runCraftItemActivity(client, agent, activity);
    }
    case 'depositItem': {
      return runDepositItemActivity(client, agent, activity);
    }
    case 'equipItem': {
      return runEquipItemActivity(client, agent, activity);
    }
    case 'farmResource': {
      return runFarmingCycle(client, agent, activity.resourceCode);
    }
    case 'fightMonster': {
      return runHuntingCycle(client, agent, activity.monsterCode);
    }
    case 'withdrawItem': {
      return runWithdrawItemActivity(client, agent, activity);
    }
  }
};
