import { describe, expect, it } from "vitest";
import { buildOSMDevelopmentApiUrl, OSM_DEVELOPMENT_SERVER_ORIGIN } from "../server/osm/developmentApi";

describe("OSM development API boundary", () => {
  it("builds URLs only on the official OSM development instance", () => {
    const url = buildOSMDevelopmentApiUrl("development", "/api/0.6/changeset/create");

    expect(url.origin).toBe(OSM_DEVELOPMENT_SERVER_ORIGIN);
    expect(url.pathname).toBe("/api/0.6/changeset/create");
  });

  it.each([undefined, "", "production", "staging", "Development"])(
    "rejects any environment other than the exact development setting (%s)",
    (environment) => {
      expect(() => buildOSMDevelopmentApiUrl(environment, "/api/0.6/changeset/create"))
        .toThrow("ausschließlich für die Entwicklungsinstanz");
    },
  );

  it.each([
    "https://www.openstreetmap.org/api/0.6/node/create",
    "//www.openstreetmap.org/api/0.6/node/create",
    "/api/0.6/../oauth2/token",
    "/api/0.6/%2e%2e/%2e%2e/oauth2/token",
    "/api/0.6/..%2f..%2foauth2/token",
    "/api/0.6/node/create?redirect=https://www.openstreetmap.org",
    "/api/0.6/node/create#fragment",
    "/api/0.6\\node\\create",
    "/oauth2/token",
  ])("rejects paths that could escape the fixed development API (%s)", (path) => {
    expect(() => buildOSMDevelopmentApiUrl("development", path))
      .toThrow("Ungültiger Pfad");
  });
});
