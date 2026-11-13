import { describe, expect, it } from "vitest";
import { buildTimeFromRevision, formatBuildTime } from "../src/pwa/buildInfo";

describe("buildTimeFromRevision", () => {
  it("rechnet die Build-Revision (Date.now() in Basis 36) in die Zeit zurück", () => {
    const built = Date.UTC(2026, 10, 13, 16, 9, 0);
    expect(buildTimeFromRevision(built.toString(36))?.getTime()).toBe(built);
  });

  it("liest die echte Revision aus der Live-Version", () => {
    // Die Revision "mwf5p8aj" stammt aus einem lokalen Build vom 13.11.2026.
    const time = buildTimeFromRevision("mwf5p8aj");
    expect(time?.getUTCFullYear()).toBe(2026);
  });

  it("lehnt Werte ab, die keine Build-Zeit sind", () => {
    expect(buildTimeFromRevision("")).toBeNull();
    expect(buildTimeFromRevision("abc")).toBeNull();
    expect(buildTimeFromRevision("ABCDEFGH")).toBeNull();
    expect(buildTimeFromRevision("a b c d")).toBeNull();
    // Zu klein (vor 2020) und zu groß (nach 2100).
    expect(buildTimeFromRevision("1000")).toBeNull();
    expect(buildTimeFromRevision("zzzzzzzzzz")).toBeNull();
  });
});

describe("formatBuildTime", () => {
  const built = Date.UTC(2026, 10, 13, 16, 9, 0).toString(36);

  it("nennt Jahr und Tag in der Sprache der App", () => {
    expect(formatBuildTime(built, "de")).toContain("2026");
    expect(formatBuildTime(built, "en")).toContain("2026");
    expect(formatBuildTime(built, "ja")).toContain("2026");
  });

  it("gibt bei einer ungültigen Revision keinen Text zurück", () => {
    expect(formatBuildTime("kaputt!", "de")).toBe("");
  });

  it("gibt bei einem ungültigen Sprachcode keinen Text zurück, statt zu werfen", () => {
    expect(formatBuildTime(built, "not a language")).toBe("");
  });
});
