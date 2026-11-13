import { describe, expect, it } from "vitest";
import { readStoredValue, writeStoredValue } from "../src/storage/safeStorage";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}
const blocked = { getItem: () => { throw new DOMException("denied", "SecurityError"); }, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };

describe("safe browser storage", () => {
  it("reads and writes normally", () => {
    const storage = memoryStorage({ a: "1" });
    expect(readStoredValue("a", storage)).toBe("1");
    expect(readStoredValue("missing", storage)).toBeNull();
    expect(writeStoredValue("b", "2", storage)).toBe(true);
    expect(storage.values.get("b")).toBe("2");
  });

  it("reads nothing, instead of throwing, when the storage cannot be read", () => {
    expect(readStoredValue("a", blocked)).toBeNull();
  });

  it("reports false, instead of throwing, when the storage cannot be written", () => {
    expect(writeStoredValue("a", "1", blocked)).toBe(false);
  });

  it("handles a missing storage (access to localStorage itself fails)", () => {
    expect(readStoredValue("a", undefined)).toBeNull();
    expect(writeStoredValue("a", "1", undefined)).toBe(false);
  });
});
