import { describe, expect, it, vi } from "vitest";
import { buildOSMProductionMapUrl, requestOSMProductionMap } from "../server/osm/productionApi";

// Der lesende Zugang zur echten OSM-API darf nur einen kleinen Ausschnitt abfragen und nichts anderes.
describe("lesender Zugang zur echten OSM-API", () => {
  it("baut nur die feste Kartenabfrage am Produktionshost", () => {
    const url = buildOSMProductionMapUrl({ west: 13.404, south: 52.519, east: 13.406, north: 52.521 });
    expect(url.origin).toBe("https://api.openstreetmap.org");
    expect(url.pathname).toBe("/api/0.6/map.json");
    expect(url.searchParams.get("bbox")).toBe("13.404,52.519,13.406,52.521");
  });

  it.each([
    ["zu groß", { west: 13, south: 52, east: 13.1, north: 52.1 }],
    ["vertauscht", { west: 13.406, south: 52.519, east: 13.404, north: 52.521 }],
    ["außerhalb der Erde", { west: 179.999, south: 52.519, east: 180.001, north: 52.521 }],
    ["keine Zahl", { west: Number.NaN, south: 52.519, east: 13.406, north: 52.521 }],
  ])("lehnt einen ungültigen Ausschnitt ab (%s), bevor etwas gesendet wird", (_label, bbox) => {
    expect(() => buildOSMProductionMapUrl(bbox)).toThrow();
  });

  it("sendet GET ohne Token, ohne Weiterleitung und mit App-Kennung", async () => {
    const fetcher = vi.fn(async () => Response.json({ elements: [] }));
    await requestOSMProductionMap(
      { west: 13.404, south: 52.519, east: 13.406, north: 52.521 },
      new AbortController().signal,
      fetcher as unknown as typeof fetch,
    );
    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("User-Agent")).toMatch(/^AEDjaeger\/\d+\.\d+\.\d+ /u);
  });

  it("folgt keiner Weiterleitung", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 302, headers: { Location: "https://example.test/" } }),
    );
    await expect(
      requestOSMProductionMap(
        { west: 13.404, south: 52.519, east: 13.406, north: 52.521 },
        new AbortController().signal,
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow();
  });
});
