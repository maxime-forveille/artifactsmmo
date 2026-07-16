import { env } from '../utils/config.js';

import { createAccountOperations } from './account.js';
import { createActionOperations } from './actions.js';
import { createCatalogOperations } from './catalog.js';
import { ArtifactsApiError } from './errors.js';
import { createArtifactsTransport } from './transport.js';

export { ArtifactsApiError };

/**
 * Composes the typed transport with dynamic account reads, cached catalog
 * queries, and elementary Actions. Every operation keeps failures explicit in a
 * `ResultAsync` rather than throwing.
 */
export const createArtifactsClient = (token: string = env.ARTIFACTS_TOKEN) => {
  const client = createArtifactsTransport(token);
  const account = createAccountOperations(client);
  const actions = createActionOperations({
    clearBankItems: account.clearBankItems,
    client,
  });
  const catalog = createCatalogOperations(client);

  return {
    client,
    craft: actions.craft,
    depositGold: actions.depositGold,
    depositItems: actions.depositItems,
    equip: actions.equip,
    fight: actions.fight,
    gather: actions.gather,
    getBankItems: account.getBankItems,
    getCharacter: account.getCharacter,
    getCharacterLogs: account.getCharacterLogs,
    getItem: catalog.getItem,
    getItems: catalog.getItems,
    getMaps: catalog.getMaps,
    getMonster: catalog.getMonster,
    getMonsters: catalog.getMonsters,
    getMyCharacters: account.getMyCharacters,
    getResource: catalog.getResource,
    getResources: catalog.getResources,
    giveItems: actions.giveItems,
    moveCharacter: actions.moveCharacter,
    rest: actions.rest,
    unequip: actions.unequip,
    withdrawGold: actions.withdrawGold,
    withdrawItems: actions.withdrawItems,
  };
};

export type ArtifactsClient = ReturnType<typeof createArtifactsClient>;
