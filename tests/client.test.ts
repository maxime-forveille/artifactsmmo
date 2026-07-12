import { describe, expect, it } from "vitest";

import { ArtifactsApiError } from "../src/client/index.js";

describe("ArtifactsApiError", () => {
  it("carries the HTTP status and response body", () => {
    const error = new ArtifactsApiError("boom", 404, { message: "not found" });

    expect(error.message).toBe("boom");
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ message: "not found" });
    expect(error.name).toBe("ArtifactsApiError");
  });
});
