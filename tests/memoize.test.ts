import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { memoizeAsync } from "../src/client/memoize.js";

const cacheKey = (...args: unknown[]): string => JSON.stringify(args);

describe("memoizeAsync", () => {
  it("calls the wrapped function only once for repeated calls with the same arguments", async () => {
    const fn = vi.fn((code: string) => okAsync(`data for ${code}`));
    const memoized = memoizeAsync(fn, cacheKey);

    const first = await memoized("copper_ore");
    const second = await memoized("copper_ore");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(first.isOk() && first.value).toBe("data for copper_ore");
    expect(second.isOk() && second.value).toBe("data for copper_ore");
  });

  it("calls the wrapped function again for a different set of arguments", async () => {
    const fn = vi.fn((code: string) => okAsync(`data for ${code}`));
    const memoized = memoizeAsync(fn, cacheKey);

    await memoized("copper_ore");
    await memoized("iron_ore");

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("shares the same in-flight call between concurrent callers, instead of sending two requests", async () => {
    const fn = vi.fn((_code: string) => okAsync("data"));
    const memoized = memoizeAsync(fn, cacheKey);

    const [first, second] = await Promise.all([memoized("copper_ore"), memoized("copper_ore")]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(first.isOk() && first.value).toBe("data");
    expect(second.isOk() && second.value).toBe("data");
  });

  it("does not cache a failed result, so the next call retries for real", async () => {
    const fn = vi.fn().mockReturnValueOnce(errAsync("boom")).mockReturnValueOnce(okAsync("data"));
    const memoized = memoizeAsync(fn, cacheKey);

    const first = await memoized("copper_ore");
    const second = await memoized("copper_ore");

    expect(fn).toHaveBeenCalledTimes(2);
    expect(first.isErr() && first.error).toBe("boom");
    expect(second.isOk() && second.value).toBe("data");
  });

  it("caches a subsequent success again after a prior failure was retried", async () => {
    const fn = vi.fn().mockReturnValueOnce(errAsync("boom")).mockReturnValueOnce(okAsync("data"));
    const memoized = memoizeAsync(fn, cacheKey);

    await memoized("copper_ore");
    await memoized("copper_ore");
    const third = await memoized("copper_ore");

    expect(fn).toHaveBeenCalledTimes(2);
    expect(third.isOk() && third.value).toBe("data");
  });
});
