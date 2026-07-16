import { memoizeAsync } from './memoize.js';
import type { paths } from './schema.js';
import { toResult, type ArtifactsTransport } from './transport.js';

/** Builds process-lifetime cached reads for static game content. */
export const createCatalogOperations = (client: ArtifactsTransport) => {
  const cacheKey = (...args: unknown[]): string => JSON.stringify(args);

  const getMaps = memoizeAsync(
    (query?: paths['/maps']['get']['parameters']['query']) =>
      toResult(
        client.GET('/maps', { params: query === undefined ? {} : { query } }),
      ),
    cacheKey,
  );

  const getItem = memoizeAsync(
    (code: string) =>
      toResult(client.GET('/items/{code}', { params: { path: { code } } })),
    cacheKey,
  );

  const getItems = memoizeAsync(
    (query?: paths['/items']['get']['parameters']['query']) =>
      toResult(
        client.GET('/items', { params: query === undefined ? {} : { query } }),
      ),
    cacheKey,
  );

  const getResource = memoizeAsync(
    (code: string) =>
      toResult(client.GET('/resources/{code}', { params: { path: { code } } })),
    cacheKey,
  );

  const getResources = memoizeAsync(
    (query?: paths['/resources']['get']['parameters']['query']) =>
      toResult(
        client.GET('/resources', {
          params: query === undefined ? {} : { query },
        }),
      ),
    cacheKey,
  );

  const getMonster = memoizeAsync(
    (code: string) =>
      toResult(client.GET('/monsters/{code}', { params: { path: { code } } })),
    cacheKey,
  );

  const getMonsters = memoizeAsync(
    (query?: paths['/monsters']['get']['parameters']['query']) =>
      toResult(
        client.GET('/monsters', {
          params: query === undefined ? {} : { query },
        }),
      ),
    cacheKey,
  );

  return {
    getItem,
    getItems,
    getMaps,
    getMonster,
    getMonsters,
    getResource,
    getResources,
  };
};
