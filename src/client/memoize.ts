import type { ResultAsync } from "neverthrow";

/**
 * Wraps `fn` so that, for the lifetime of the returned function, calls with
 * the same arguments (compared via `keyFor`) only ever call `fn` once and
 * share its result - meant for read-only endpoints whose data is static for
 * as long as the bot process runs (item/monster/resource/map catalogs),
 * where re-fetching the exact same query every cycle wastes a real request
 * against the account's hourly rate limit for no benefit (see
 * `client/index.ts`'s rate limiter).
 *
 * Only successful results are cached - a failed attempt (a transient
 * network issue, a rate limit, ...) is evicted immediately so the very
 * next call retries for real, rather than replaying the same failure
 * forever.
 */
export const memoizeAsync = <Args extends readonly unknown[], T, E>(
  fn: (...args: Args) => ResultAsync<T, E>,
  keyFor: (...args: Args) => string,
): ((...args: Args) => ResultAsync<T, E>) => {
  const cache = new Map<string, ResultAsync<T, E>>();

  return (...args: Args): ResultAsync<T, E> => {
    const key = keyFor(...args);
    const cached = cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const entry = fn(...args);
    cache.set(key, entry);
    entry.mapErr((error) => {
      cache.delete(key);
      return error;
    });

    return entry;
  };
};
