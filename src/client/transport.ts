import { err, ok, ResultAsync } from 'neverthrow';
import createClient from 'openapi-fetch';

import { logger } from '../utils/logger.js';

import { API_BASE_URL } from './constants.js';
import { ArtifactsApiError } from './errors.js';
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  isActionRequest,
  isDataRequest,
  withSafetyMargin,
} from './middleware.js';
import type { paths } from './schema.js';

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

export type ArtifactsTransport = ReturnType<typeof createClient<paths>>;

/** Converts the transport promise into the client's typed failure boundary. */
export const toResult = <T>(
  promise: Promise<FetchResult<T>>,
): ResultAsync<T, ArtifactsApiError> =>
  ResultAsync.fromPromise(
    promise,
    (thrown) =>
      new ArtifactsApiError('Artifacts API request failed to send', 0, thrown),
  ).andThen(({ data, error, response }) => {
    if (error !== undefined) {
      logger.error(
        { body: error, status: response.status, url: response.url },
        'Artifacts API request failed',
      );
      return err(
        new ArtifactsApiError(
          `Artifacts API request failed: ${response.status} ${response.statusText}`,
          response.status,
          error,
        ),
      );
    }

    if (data === undefined) {
      return err(
        new ArtifactsApiError(
          'Artifacts API response contained no data',
          response.status,
          undefined,
        ),
      );
    }

    return ok(data);
  });

/**
 * Leaves headroom for network timing, server clock boundaries, and other
 * traffic sharing the account or IP rate-limit buckets.
 */
const SAFETY_MARGIN = 0.6;

/** Creates the authenticated, account-rate-limited OpenAPI transport. */
export const createArtifactsTransport = (token: string): ArtifactsTransport => {
  const client = createClient<paths>({ baseUrl: API_BASE_URL });
  client.use(createAuthMiddleware(token));
  client.use(
    createRateLimitMiddleware(
      isActionRequest,
      withSafetyMargin(
        [
          { limit: 10, windowMs: 1_000 },
          { limit: 100, windowMs: 60_000 },
          { limit: 5_000, windowMs: 3_600_000 },
        ],
        SAFETY_MARGIN,
      ),
    ),
  );
  client.use(
    createRateLimitMiddleware(
      isDataRequest,
      withSafetyMargin(
        [
          { limit: 10, windowMs: 1_000 },
          { limit: 200, windowMs: 60_000 },
          { limit: 2_000, windowMs: 3_600_000 },
        ],
        SAFETY_MARGIN,
      ),
    ),
  );

  return client;
};
