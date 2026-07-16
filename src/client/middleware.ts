import type { Middleware } from 'openapi-fetch';

import {
  createRateLimiter,
  type RateLimiter,
  type RateLimitWindow,
} from './rateLimiter.js';

type CreateLimiter = (windows: readonly RateLimitWindow[]) => RateLimiter;

export const createAuthMiddleware = (token: string): Middleware => ({
  onRequest({ request }) {
    request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
});

export const createRateLimitMiddleware = (
  shouldLimit: (request: Request) => boolean,
  windows: readonly RateLimitWindow[],
  createLimiter: CreateLimiter = createRateLimiter,
): Middleware => {
  const limiter = createLimiter(windows);

  return {
    async onRequest({ request }) {
      if (shouldLimit(request)) {
        await limiter.acquire();
      }

      return request;
    },
  };
};

export const isActionRequest = (request: Request): boolean =>
  new URL(request.url).pathname.includes('/action/');

export const isDataRequest = (request: Request): boolean =>
  request.method === 'GET';

export const withSafetyMargin = (
  windows: readonly RateLimitWindow[],
  safetyMargin: number,
): RateLimitWindow[] =>
  windows.map((window) => ({
    ...window,
    limit: Math.max(1, Math.floor(window.limit * safetyMargin)),
  }));
