import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createArtifactsClient } from '../src/client/index.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('createArtifactsClient actions', () => {
  it('sends the destination to the requested character', async () => {
    let receivedBody: unknown;
    let receivedPath: string | undefined;

    server.use(
      http.post(
        'https://api.artifactsmmo.com/my/:name/action/move',
        async ({ request }) => {
          receivedBody = await request.json();
          receivedPath = new URL(request.url).pathname;

          return HttpResponse.json({
            data: {
              character: {},
              cooldown: {
                expiration: '2024-01-01T00:00:05.000Z',
                reason: 'movement',
                remaining_seconds: 5,
                started_at: '2024-01-01T00:00:00.000Z',
                total_seconds: 5,
              },
              destination: {},
              path: [],
            },
          });
        },
      ),
    );

    const client = createArtifactsClient('test-token');
    const result = await client.moveCharacter('Cartman', { x: 1, y: 2 });

    expect(receivedBody).toEqual({ x: 1, y: 2 });
    expect(receivedPath).toBe('/my/Cartman/action/move');
    expect(result.isOk()).toBe(true);
  });

  it.each([
    {
      expectedBody: undefined,
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.rest('Cartman'),
      label: 'rest',
      path: '/my/Cartman/action/rest',
    },
    {
      expectedBody: undefined,
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.gather('Cartman'),
      label: 'gather',
      path: '/my/Cartman/action/gathering',
    },
    {
      expectedBody: undefined,
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.fight('Cartman'),
      label: 'fight without participants',
      path: '/my/Cartman/action/fight',
    },
    {
      expectedBody: { participants: ['Stan', 'Kyle'] },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.fight('Cartman', ['Stan', 'Kyle']),
      label: 'fight with participants',
      path: '/my/Cartman/action/fight',
    },
    {
      expectedBody: { code: 'copper_pickaxe', quantity: 3 },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.craft('Cartman', 'copper_pickaxe', 3),
      label: 'craft',
      path: '/my/Cartman/action/crafting',
    },
    {
      expectedBody: [{ code: 'copper_pickaxe', quantity: 1, slot: 'weapon' }],
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.equip('Cartman', [
          { code: 'copper_pickaxe', quantity: 1, slot: 'weapon' },
        ]),
      label: 'equip',
      path: '/my/Cartman/action/equip',
    },
    {
      expectedBody: [{ quantity: 1, slot: 'weapon' }],
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.unequip('Cartman', [{ quantity: 1, slot: 'weapon' }]),
      label: 'unequip',
      path: '/my/Cartman/action/unequip',
    },
    {
      expectedBody: {
        character: 'Stan',
        items: [{ code: 'copper_ore', quantity: 2 }],
      },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.giveItems('Cartman', 'Stan', [
          { code: 'copper_ore', quantity: 2 },
        ]),
      label: 'giveItems',
      path: '/my/Cartman/action/give/item',
    },
    {
      expectedBody: [{ code: 'copper_ore', quantity: 4 }],
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.depositItems('Cartman', [{ code: 'copper_ore', quantity: 4 }]),
      label: 'depositItems',
      path: '/my/Cartman/action/bank/deposit/item',
    },
    {
      expectedBody: [{ code: 'copper_ore', quantity: 4 }],
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.withdrawItems('Cartman', [{ code: 'copper_ore', quantity: 4 }]),
      label: 'withdrawItems',
      path: '/my/Cartman/action/bank/withdraw/item',
    },
    {
      expectedBody: { quantity: 100 },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.depositGold('Cartman', 100),
      label: 'depositGold',
      path: '/my/Cartman/action/bank/deposit/gold',
    },
    {
      expectedBody: { quantity: 75 },
      invoke: (client: ReturnType<typeof createArtifactsClient>) =>
        client.withdrawGold('Cartman', 75),
      label: 'withdrawGold',
      path: '/my/Cartman/action/bank/withdraw/gold',
    },
  ])(
    '$label sends the expected action request and returns a successful Result',
    async ({ expectedBody, invoke, label, path }) => {
      let receivedBody: unknown;
      let receivedPath: string | undefined;

      server.use(
        http.post(
          `https://api.artifactsmmo.com${path}`,
          async ({ request }) => {
            receivedPath = new URL(request.url).pathname;
            const body = await request.text();
            receivedBody = body === '' ? undefined : JSON.parse(body);

            return HttpResponse.json({ data: { action: label } });
          },
        ),
      );

      const client = createArtifactsClient('test-token');
      const result = await invoke(client);

      expect(receivedPath).toBe(path);
      expect(receivedBody).toEqual(expectedBody);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ data: { action: label } });
    },
  );

  it('invalidates cached bank data after a successful bank deposit', async () => {
    let bankRequestCount = 0;

    server.use(
      http.get('https://api.artifactsmmo.com/my/bank/items', () => {
        bankRequestCount += 1;
        return HttpResponse.json({
          data: [],
          page: 1,
          pages: 1,
          size: 50,
          total: 0,
        });
      }),
      http.post(
        'https://api.artifactsmmo.com/my/:name/action/bank/deposit/item',
        () => HttpResponse.json({ data: {} }),
      ),
    );

    const client = createArtifactsClient('test-token');

    await client.getBankItems({ item_code: 'copper_ore' });
    await client.getBankItems({ item_code: 'copper_ore' });
    await client.depositItems('Cartman', [{ code: 'copper_ore', quantity: 1 }]);
    await client.getBankItems({ item_code: 'copper_ore' });

    expect(bankRequestCount).toBe(2);
  });

  it('invalidates cached bank data after a successful bank withdrawal', async () => {
    let bankRequestCount = 0;

    server.use(
      http.get('https://api.artifactsmmo.com/my/bank/items', () => {
        bankRequestCount += 1;
        return HttpResponse.json({
          data: [],
          page: 1,
          pages: 1,
          size: 50,
          total: 0,
        });
      }),
      http.post(
        'https://api.artifactsmmo.com/my/:name/action/bank/withdraw/item',
        () => HttpResponse.json({ data: {} }),
      ),
    );

    const client = createArtifactsClient('test-token');

    await client.getBankItems({ item_code: 'copper_ore' });
    await client.getBankItems({ item_code: 'copper_ore' });
    const withdrawal = await client.withdrawItems('Cartman', [
      { code: 'copper_ore', quantity: 1 },
    ]);
    await client.getBankItems({ item_code: 'copper_ore' });

    expect(withdrawal.isOk()).toBe(true);
    expect(bankRequestCount).toBe(2);
  });
});
