import { describe, expect, it } from "vitest";
import { buildOSMDevelopmentApiUrl, OSM_DEVELOPMENT_SERVER_ORIGIN, requestOSMDevelopmentApi } from "../server/osm/developmentApi";

describe("OSM development API boundary", () => {
  it("rejects a redirect without forwarding the test token or XML body", async () => {
    const calls: string[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push(String(input));
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-token");
      expect(init?.body).toBe("<osm />");
      return new Response(null, { status: 307, headers: { Location: "https://www.openstreetmap.org/api/0.6/changeset/create" } });
    };
    await expect(requestOSMDevelopmentApi("development", "/api/0.6/changeset/create", "fixture-token", {
      method: "PUT", body: "<osm />",
    }, fetcher)).rejects.toThrow("Weiterleitungen");
    expect(calls).toEqual([`${OSM_DEVELOPMENT_SERVER_ORIGIN}/api/0.6/changeset/create`]);
  });

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
