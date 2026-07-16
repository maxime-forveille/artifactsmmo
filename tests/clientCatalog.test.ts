import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createArtifactsClient } from '../src/client/index.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('createArtifactsClient catalog', () => {
  it('fetches an item by code', async () => {
    server.use(
      http.get('https://api.artifactsmmo.com/items/:code', ({ params }) =>
        HttpResponse.json({
          data: {
            code: params['code'],
            craft: {
              items: [{ code: 'copper_ore', quantity: 6 }],
              level: 1,
              quantity: 1,
              skill: 'weaponcrafting',
            },
          },
        }),
      ),
    );

    const client = createArtifactsClient('test-token');
    const result = await client.getItem('copper_pickaxe');

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data.code).toBe('copper_pickaxe');
  });

  it.each([
    {
      code: 'copper_rocks',
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getResource('copper_rocks'),
      path: '/resources/copper_rocks',
    },
    {
      code: 'chicken',
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getMonster('chicken'),
      path: '/monsters/chicken',
    },
  ])(
    'fetches $code from $path and returns a successful Result',
    async ({ code, invoke, path }) => {
      let receivedPath: string | undefined;

      server.use(
        http.get(`https://api.artifactsmmo.com${path}`, ({ request }) => {
          receivedPath = new URL(request.url).pathname;
          return HttpResponse.json({ data: { code } });
        }),
      );

      const client = createArtifactsClient('test-token');
      const result = await invoke(client);

      expect(receivedPath).toBe(path);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ data: { code } });
    },
  );

  it.each([
    {
      expectedQuery: {
        max_level: '10',
        min_level: '1',
        name: 'Copper',
        page: '2',
        size: '25',
      },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getItems({
          max_level: 10,
          min_level: 1,
          name: 'Copper',
          page: 2,
          size: 25,
        }),
      label: 'getItems',
      path: '/items',
      responseData: [{ code: 'copper_pickaxe' }],
    },
    {
      expectedQuery: {
        drop: 'copper_ore',
        max_level: '20',
        min_level: '1',
        page: '3',
        size: '10',
        skill: 'mining',
      },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getResources({
          drop: 'copper_ore',
          max_level: 20,
          min_level: 1,
          page: 3,
          size: 10,
          skill: 'mining',
        }),
      label: 'getResources',
      path: '/resources',
      responseData: [{ code: 'copper_rocks' }],
    },
    {
      expectedQuery: {
        drop: 'raw_chicken',
        max_level: '10',
        min_level: '1',
        name: 'Chicken',
        page: '2',
        size: '20',
      },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getMonsters({
          drop: 'raw_chicken',
          max_level: 10,
          min_level: 1,
          name: 'Chicken',
          page: 2,
          size: 20,
        }),
      label: 'getMonsters',
      path: '/monsters',
      responseData: [{ code: 'chicken' }],
    },
    {
      expectedQuery: { item_code: 'copper_ore', page: '4', size: '50' },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getBankItems({ item_code: 'copper_ore', page: 4, size: 50 }),
      label: 'getBankItems',
      path: '/my/bank/items',
      responseData: [{ code: 'copper_ore', quantity: 12 }],
    },
  ])(
    '$label forwards its query and returns a successful Result',
    async ({ expectedQuery, invoke, path, responseData }) => {
      let receivedPath: string | undefined;
      let receivedQuery: Record<string, string> = {};

      server.use(
        http.get(`https://api.artifactsmmo.com${path}`, ({ request }) => {
          const url = new URL(request.url);
          receivedPath = url.pathname;
          receivedQuery = Object.fromEntries(url.searchParams);

          return HttpResponse.json({
            data: responseData,
            page: 1,
            pages: 1,
            size: responseData.length,
            total: responseData.length,
          });
        }),
      );

      const client = createArtifactsClient('test-token');
      const result = await invoke(client);

      expect(receivedPath).toBe(path);
      expect(receivedQuery).toEqual(expectedQuery);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().data).toEqual(responseData);
    },
  );

  it.each([
    {
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getMaps(),
      label: 'getMaps',
      path: '/maps',
    },
    {
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getItems(),
      label: 'getItems',
      path: '/items',
    },
    {
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getResources(),
      label: 'getResources',
      path: '/resources',
    },
    {
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getMonsters(),
      label: 'getMonsters',
      path: '/monsters',
    },
    {
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.getBankItems(),
      label: 'getBankItems',
      path: '/my/bank/items',
    },
  ])('$label supports an omitted query', async ({ invoke, path }) => {
    let receivedQuery = 'not-called';

    server.use(
      http.get(`https://api.artifactsmmo.com${path}`, ({ request }) => {
        receivedQuery = new URL(request.url).search;
        return HttpResponse.json({
          data: [],
          page: 1,
          pages: 1,
          size: 0,
          total: 0,
        });
      }),
    );

    const result = await invoke(createArtifactsClient('test-token'));

    expect(receivedQuery).toBe('');
    expect(result.isOk()).toBe(true);
  });

  it('keeps distinct catalog queries in separate cache entries', async () => {
    const requestedPages: string[] = [];

    server.use(
      http.get('https://api.artifactsmmo.com/items', ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? 'missing';
        requestedPages.push(page);
        return HttpResponse.json({
          data: [{ code: `page_${page}` }],
          page: Number(page),
          pages: 2,
          size: 1,
          total: 2,
        });
      }),
    );

    const client = createArtifactsClient('test-token');

    await client.getItems({ page: 1 });
    await client.getItems({ page: 1 });
    await client.getItems({ page: 2 });

    expect(requestedPages).toEqual(['1', '2']);
  });

  it('forwards content_code/content_type as query params and returns the map page', async () => {
    let receivedQuery: Record<string, string> = {};

    server.use(
      http.get('https://api.artifactsmmo.com/maps', ({ request }) => {
        receivedQuery = Object.fromEntries(new URL(request.url).searchParams);

        return HttpResponse.json({
          data: [{ map_id: 42, name: 'Copper Rocks', x: 2, y: 1 }],
          page: 1,
          pages: 1,
          size: 50,
          total: 1,
        });
      }),
    );

    const client = createArtifactsClient('test-token');
    const result = await client.getMaps({
      content_code: 'copper_rocks',
      content_type: 'resource',
    });

    expect(receivedQuery).toEqual({
      content_code: 'copper_rocks',
      content_type: 'resource',
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data).toEqual([
      { map_id: 42, name: 'Copper Rocks', x: 2, y: 1 },
    ]);
  });
});
