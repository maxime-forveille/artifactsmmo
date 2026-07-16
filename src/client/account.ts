import { memoizeAsyncWithTtl } from './memoize.js';
import type { paths } from './schema.js';
import { toResult, type ArtifactsTransport } from './transport.js';

const CHARACTER_LOG_CACHE_TTL_MS = 120_000;
const BANK_ITEMS_CACHE_TTL_MS = 5_000;

/** Builds dynamic account reads and exposes bank-cache invalidation to Actions. */
export const createAccountOperations = (client: ArtifactsTransport) => {
  const cacheKey = (...args: unknown[]): string => JSON.stringify(args);

  const getCharacter = (name: string) =>
    toResult(client.GET('/characters/{name}', { params: { path: { name } } }));

  const getMyCharacters = () => toResult(client.GET('/my/characters'));

  const cachedBankItems = memoizeAsyncWithTtl(
    (query?: paths['/my/bank/items']['get']['parameters']['query']) =>
      toResult(
        client.GET('/my/bank/items', {
          params: query === undefined ? {} : { query },
        }),
      ),
    cacheKey,
    BANK_ITEMS_CACHE_TTL_MS,
  );
  const getBankItems = (
    query?: paths['/my/bank/items']['get']['parameters']['query'],
  ) => cachedBankItems(query);

  const cachedCharacterLogs = memoizeAsyncWithTtl(
    (
      name: string,
      query?: paths['/my/logs/{name}']['get']['parameters']['query'],
    ) =>
      toResult(
        client.GET('/my/logs/{name}', {
          params: { path: { name }, query: query ?? {} },
        }),
      ),
    cacheKey,
    CHARACTER_LOG_CACHE_TTL_MS,
  );
  const getCharacterLogs = (
    name: string,
    query?: paths['/my/logs/{name}']['get']['parameters']['query'],
  ) => cachedCharacterLogs(name, query);

  return {
    clearBankItems: cachedBankItems.clear,
    getBankItems,
    getCharacter,
    getCharacterLogs,
    getMyCharacters,
  };
};
