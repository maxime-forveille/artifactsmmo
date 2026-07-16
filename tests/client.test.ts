import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ArtifactsApiError,
  createArtifactsClient,
} from '../src/client/index.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('ArtifactsApiError', () => {
  it('carries the HTTP status and response body', () => {
    const error = new ArtifactsApiError('boom', 404, { message: 'not found' });

    expect(error.message).toBe('boom');
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ message: 'not found' });
    expect(error.name).toBe('ArtifactsApiError');
  });
});

describe('createArtifactsClient', () => {
  it('sends the bearer token and returns the parsed character on success', async () => {
    let receivedAuth: string | null = null;

    server.use(
      http.get(
        'https://api.artifactsmmo.com/characters/:name',
        ({ request, params }) => {
          receivedAuth = request.headers.get('Authorization');
          return HttpResponse.json({ data: { name: params['name'] } });
        },
      ),
    );

    const client = createArtifactsClient('test-token');
    const result = await client.getCharacter('Cartman');

    expect(receivedAuth).toBe('Bearer test-token');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data.name).toBe('Cartman');
  });

  it('maps a successful response without data to an ArtifactsApiError', async () => {
    server.use(
      http.get(
        'https://api.artifactsmmo.com/characters/:name',
        () => new HttpResponse(null, { status: 200 }),
      ),
    );

    const client = createArtifactsClient('test-token');
    const result = await client.getCharacter('Cartman');

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(ArtifactsApiError);
    expect(error.message).toBe('Artifacts API response contained no data');
    expect(error.status).toBe(200);
    expect(error.body).toBeUndefined();
  });

  it('fetches every character owned by the authenticated account', async () => {
    server.use(
      http.get('https://api.artifactsmmo.com/my/characters', () =>
        HttpResponse.json({ data: [{ name: 'Cartman' }, { name: 'Stan' }] }),
      ),
    );

    const client = createArtifactsClient('test-token');
    const result = await client.getMyCharacters();

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().data.map((character) => character.name),
    ).toEqual(['Cartman', 'Stan']);
  });

  it('maps a non-2xx response to an ArtifactsApiError', async () => {
    server.use(
      http.get('https://api.artifactsmmo.com/characters/:name', () =>
        HttpResponse.json(
          { error: { code: 498, message: 'Character not found.' } },
          { status: 498 },
        ),
      ),
    );

    const client = createArtifactsClient('test-token');
    const result = await client.getCharacter('Ghost');

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(ArtifactsApiError);
    expect(error.message).toBe('Artifacts API request failed: 498 ');
    expect(error.status).toBe(498);
    expect(error.body).toEqual({
      error: { code: 498, message: 'Character not found.' },
    });
  });

  it('maps a transport failure to an ArtifactsApiError', async () => {
    server.use(
      http.get('https://api.artifactsmmo.com/characters/:name', () =>
        HttpResponse.error(),
      ),
    );

    const result =
      await createArtifactsClient('test-token').getCharacter('Cartman');

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(ArtifactsApiError);
    expect(error.message).toBe('Artifacts API request failed to send');
    expect(error.status).toBe(0);
    expect(error.body).toBeInstanceOf(TypeError);
  });

  it('caches identical log reads while keeping distinct queries separate', async () => {
    const receivedRequests: { name: string; query: Record<string, string> }[] =
      [];

    server.use(
      http.get(
        'https://api.artifactsmmo.com/my/logs/:name',
        ({ params, request }) => {
          receivedRequests.push({
            name: String(params['name']),
            query: Object.fromEntries(new URL(request.url).searchParams),
          });
          return HttpResponse.json({
            data: [],
            page: 1,
            pages: 1,
            size: 100,
            total: 0,
          });
        },
      ),
    );

    const client = createArtifactsClient('test-token');

    await client.getCharacterLogs('Cartman', { size: 100 });
    await client.getCharacterLogs('Cartman', { size: 100 });
    await client.getCharacterLogs('Stan', { size: 50 });
    await client.getCharacterLogs('Kenny');

    expect(receivedRequests).toEqual([
      { name: 'Cartman', query: { size: '100' } },
      { name: 'Stan', query: { size: '50' } },
      { name: 'Kenny', query: {} },
    ]);
  });
});
