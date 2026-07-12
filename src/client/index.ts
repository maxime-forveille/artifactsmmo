import createClient, { type Middleware } from "openapi-fetch";

import { env } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import type { paths } from "./schema.js";

const API_BASE_URL = "https://api.artifactsmmo.com";

export class ArtifactsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ArtifactsApiError";
  }
}

type FetchResult<T> = {
  data?: T;
  error?: unknown;
  response: Response;
};

const unwrap = async <T>(result: Promise<FetchResult<T>>): Promise<T> => {
  const { data, error, response } = await result;

  if (error !== undefined) {
    logger.error(
      { body: error, status: response.status, url: response.url },
      "Artifacts API request failed",
    );
    throw new ArtifactsApiError(
      `Artifacts API request failed: ${response.status} ${response.statusText}`,
      response.status,
      error,
    );
  }

  return data as T;
};

const authMiddleware = (token: string): Middleware => ({
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
});

/**
 * Thin, fully-typed wrapper around the Artifacts MMO REST API.
 * @see https://docs.artifactsmmo.com/
 */
export const createArtifactsClient = (token: string = env.ARTIFACTS_TOKEN) => {
  const client = createClient<paths>({ baseUrl: API_BASE_URL });
  client.use(authMiddleware(token));

  const getCharacter = (name: string) =>
    unwrap(client.GET("/characters/{name}", { params: { path: { name } } }));

  return { client, getCharacter };
};

export type ArtifactsClient = ReturnType<typeof createArtifactsClient>;

export const bot = createArtifactsClient();
