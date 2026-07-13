import type { ResultAsync } from "neverthrow";

import { waitUntil } from "../../utils/cooldown.js";
import { logger } from "../../utils/logger.js";

const RETRY_DELAY_MS = 10_000;

/**
 * Runs `cycle()` forever, logging its outcome each time and waiting
 * `RETRY_DELAY_MS` before retrying after a failure.
 */
export const runForever = async <E extends Error>(
  characterName: string,
  label: string,
  cycle: () => ResultAsync<void, E>,
): Promise<void> => {
  for (;;) {
    const result = await cycle();

    await result.match(
      async () => {
        logger.info({ character: characterName }, `${characterName}: ${label} completed`);
      },
      async (error) => {
        // pino's overloaded error() signature doesn't resolve well against a
        // generic error type; the `E extends Error` constraint above makes
        // this cast sound.
        logger.error(error as Error, `${characterName}: ${label} failed, retrying shortly`);
        await waitUntil(new Date(Date.now() + RETRY_DELAY_MS).toISOString());
      },
    );
  }
};
