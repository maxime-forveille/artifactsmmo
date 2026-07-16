import type { Middleware } from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  isActionRequest,
  isDataRequest,
  withSafetyMargin,
} from '../src/client/middleware.js';
import type { RateLimitWindow } from '../src/client/rateLimiter.js';

const runOnRequest = async (
  middleware: Middleware,
  request: Request,
): Promise<unknown> => {
  if (middleware.onRequest === undefined) {
    return undefined;
  }

  return middleware.onRequest({ request } as Parameters<
    NonNullable<Middleware['onRequest']>
  >[0]);
};

describe('client middleware', () => {
  it('adds the bearer token to outgoing requests', async () => {
    const request = new Request('https://api.artifactsmmo.com/items');

    const result = await runOnRequest(
      createAuthMiddleware('test-token'),
      request,
    );

    expect(result).toBe(request);
    expect(request.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('limits matching requests through the configured limiter', async () => {
    const acquire = vi.fn(async () => undefined);
    const windows: readonly RateLimitWindow[] = [{ limit: 6, windowMs: 1_000 }];
    const createLimiter = vi.fn(() => ({ acquire }));
    const request = new Request('https://api.artifactsmmo.com/items');
    const middleware = createRateLimitMiddleware(
      () => true,
      windows,
      createLimiter,
    );

    const result = await runOnRequest(middleware, request);

    expect(createLimiter).toHaveBeenCalledWith(windows);
    expect(acquire).toHaveBeenCalledOnce();
    expect(result).toBe(request);
  });

  it('does not acquire a slot for a request outside the bucket', async () => {
    const acquire = vi.fn(async () => undefined);
    const request = new Request('https://api.artifactsmmo.com/items');
    const middleware = createRateLimitMiddleware(
      () => false,
      [{ limit: 6, windowMs: 1_000 }],
      () => ({ acquire }),
    );

    const result = await runOnRequest(middleware, request);

    expect(acquire).not.toHaveBeenCalled();
    expect(result).toBe(request);
  });

  it('classifies Action and data requests into separate buckets', () => {
    const action = new Request(
      'https://api.artifactsmmo.com/my/Cartman/action/fight',
      { method: 'POST' },
    );
    const data = new Request('https://api.artifactsmmo.com/items');
    const nonActionPost = new Request(
      'https://api.artifactsmmo.com/my/token/create',
      { method: 'POST' },
    );

    expect(isActionRequest(action)).toBe(true);
    expect(isActionRequest(data)).toBe(false);
    expect(isDataRequest(data)).toBe(true);
    expect(isDataRequest(action)).toBe(false);
    expect(isDataRequest(nonActionPost)).toBe(false);
  });

  it('applies the safety margin without reducing a limit below one', () => {
    expect(
      withSafetyMargin(
        [
          { limit: 10, windowMs: 1_000 },
          { limit: 1, windowMs: 60_000 },
        ],
        0.6,
      ),
    ).toEqual([
      { limit: 6, windowMs: 1_000 },
      { limit: 1, windowMs: 60_000 },
    ]);
  });
});
