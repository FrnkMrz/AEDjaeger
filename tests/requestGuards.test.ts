import { describe, expect, it } from "vitest";
import { readOSMSessionCookie } from "../server/http/requestGuards";

const legacyToken = "l".repeat(43);
const currentToken = "c".repeat(43);

describe("OSM session cookie migration", () => {
  it("continues to read the previous cookie name for one-version migration", () => {
    expect(readOSMSessionCookie(`aedjaeger_osm_session=${legacyToken}`)).toBe(legacyToken);
  });

  it("prefers the __Host cookie when both names are present", () => {
    expect(readOSMSessionCookie(`aedjaeger_osm_session=${legacyToken}; __Host-aedjaeger_osm_session=${currentToken}`)).toBe(currentToken);
  });

  it("does not fall back to the legacy name when the new cookie is ambiguous", () => {
    expect(readOSMSessionCookie(`__Host-aedjaeger_osm_session=${currentToken}; __Host-aedjaeger_osm_session=${legacyToken}; aedjaeger_osm_session=${legacyToken}`)).toBeNull();
  });
});
