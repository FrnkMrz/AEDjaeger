import { describe, expect, it } from "vitest";
import { isRecord } from "../shared/typeGuards.js";

describe("shared JSON type guards", () => {
  it("accepts objects and rejects null, primitives, and arrays", () => {
    expect(isRecord({ key: "value" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(["value"])).toBe(false);
    expect(isRecord("value")).toBe(false);
  });
});
