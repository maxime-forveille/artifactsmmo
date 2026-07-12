import { env } from "../utils/config.js";
import { logger } from "../utils/logger.js";

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

/**
 * Thin wrapper around the Artifacts MMO REST API.
 * @see https://docs.artifactsmmo.com/
 */
export class ArtifactsClient {
  constructor(private readonly token: string = env.ARTIFACTS_TOKEN) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${path}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      logger.error({ status: response.status, body, url }, "Artifacts API request failed");
      throw new ArtifactsApiError(
        `Artifacts API request failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return (await response.json()) as T;
  }

  async getCharacter(name: string) {
    return this.request(`/characters/${name}`);
  }
}

export const bot = new ArtifactsClient();
