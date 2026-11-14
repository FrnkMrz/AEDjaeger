import { describe, expect, it } from "vitest";
import { PbfWriter } from "pbf";
import {
  countLayerFeatures,
  parseCliArguments,
  readLimited,
  runLiveSearchCheck,
  tileForCoordinate,
  validateHeader,
  validateMetadata,
  type ArchiveReader,
} from "../scripts/check-live-search.mjs";
// ?raw liefert den Quelltext als Zeichenkette (Vite), ohne Node-Dateizugriff im Test.
import routeSource from "../server/osm/staticCandidateSearchRoute.ts?raw";
import scriptSource from "../scripts/check-live-search.mjs?raw";

// Diese Tests laufen komplett ohne Netz. Die Datenquelle wird durch Fakes ersetzt,
// damit der Ablauf des Live-Checks geprüft werden kann, ohne pipeline.openfiremap.org zu berühren.

const NOW = Date.parse("2026-11-10T12:00:00Z");
const FRESH = "2026-11-10T08:00:00Z";

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const extract = { status: "downloaded", osm_data_timestamp: FRESH };
  return {
    status: "ok",
    region: "dachlilu",
    generated_at: FRESH,
    osm_data_until: FRESH,
    extracts: { germany: extract, austria: extract, switzerland: extract, luxembourg: extract, liechtenstein: extract },
    pmtiles: { file: "openfiremap.pmtiles", size_bytes: 1_000_000 },
    features: { defibrillators: { count: 42 } },
    ...overrides,
  };
}

const header = { tileType: 1, minZoom: 0, maxZoom: 14, minLon: 5, minLat: 45, maxLon: 18, maxLat: 56 };

/** Baut eine kleine Vektorkachel mit so vielen Punkten je Ebene, wie angegeben. */
function encodeTile(layers: Record<string, number>): ArrayBuffer {
  const writer = new PbfWriter();
  for (const [name, count] of Object.entries(layers)) {
    writer.writeMessage(3, (layer: { name: string; count: number }, pbf: PbfWriter) => {
      pbf.writeVarintField(15, 2);
      pbf.writeStringField(1, layer.name);
      for (let index = 0; index < layer.count; index += 1) {
        pbf.writeMessage(2, (_unused: unknown, feature: PbfWriter) => {
          feature.writeVarintField(3, 1); // Typ POINT
          feature.writePackedVarint(4, [9, 50, 34]); // MoveTo, Koordinaten (25, 17)
        }, undefined);
      }
      pbf.writeVarintField(5, 4096);
    }, { name, count });
  }
  const bytes = writer.finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("Eingaben des Live-Checks", () => {
  it("verwendet ohne Argumente den Standard Nürnberg Hauptbahnhof", () => {
    expect(parseCliArguments([])).toEqual({ latitude: 49.4456, longitude: 11.0825 });
  });

  it("übernimmt gültige Koordinaten in beiden Schreibweisen", () => {
    expect(parseCliArguments(["--lat", "48.1374", "--lon=11.5755"])).toEqual({ latitude: 48.1374, longitude: 11.5755 });
  });

  it("lehnt ungültige Zahlen, Bereiche, unbekannte Optionen und fehlende Werte ab", () => {
    expect(() => parseCliArguments(["--lat", "NaN"])).toThrow("einfache Dezimalzahlen");
    expect(() => parseCliArguments(["--lat", "1e3"])).toThrow("einfache Dezimalzahlen");
    expect(() => parseCliArguments(["--lat", "91"])).toThrow("zwischen -90 und 90");
    expect(() => parseCliArguments(["--lon", "181"])).toThrow("zwischen -180 und 180");
    expect(() => parseCliArguments(["--foo", "1"])).toThrow("Unbekannte Option");
    expect(() => parseCliArguments(["--lat"])).toThrow("braucht einen Wert");
  });
});

describe("Kachelberechnung", () => {
  it("berechnet für Nürnberg Hauptbahnhof die Zoom-14-Kachel 8696/5595", () => {
    expect(tileForCoordinate(11.0825, 49.4456, 14)).toEqual({ z: 14, x: 8696, y: 5595 });
  });
});

describe("Metadaten-Prüfung", () => {
  it("akzeptiert frische, vollständige Metadaten", () => {
    const result = validateMetadata(metadata(), NOW);
    expect(result.ageHours).toBeCloseTo(4, 5);
    expect(result.featureCount).toBe(42);
  });

  it("lehnt veraltete OSM-Daten ab (älter als 5 Tage = 120 Stunden)", () => {
    expect(() => validateMetadata(metadata({ osm_data_until: "2026-11-05T11:59:00Z" }), NOW))
      .toThrow("120 Stunden");
  });

  it("akzeptiert vier Tage alte OSM-Daten, weil die Grenze bei 5 Tagen liegt", () => {
    // Die Länderextrakte müssen dieselbe Grenze einhalten; hier sind sie ebenfalls vier Tage alt.
    const fourDaysOld = "2026-11-06T12:00:00Z";
    const extract = { status: "downloaded", osm_data_timestamp: fourDaysOld };
    const result = validateMetadata(metadata({
      osm_data_until: fourDaysOld,
      extracts: { germany: extract, austria: extract, switzerland: extract, luxembourg: extract, liechtenstein: extract },
    }), NOW);
    expect(result.ageHours).toBeCloseTo(96, 5);
  });

  it("lehnt einen veralteten Länderextrakt ab, auch wenn osm_data_until frisch ist", () => {
    const stale = { status: "downloaded", osm_data_timestamp: "2026-11-01T00:00:00Z" };
    const value = metadata() as { extracts: Record<string, unknown> };
    value.extracts.austria = stale;
    expect(() => validateMetadata(value, NOW)).toThrow("„austria“");
  });

  it("lehnt Zeitstempel in der Zukunft, fremde Regionen und unvollständige Felder ab", () => {
    expect(() => validateMetadata(metadata({ generated_at: "2026-11-11T12:00:00Z" }), NOW)).toThrow("Zeitstempel");
    expect(() => validateMetadata(metadata({ region: "world" }), NOW)).toThrow("Format");
    expect(() => validateMetadata(metadata({ features: {} }), NOW)).toThrow("Format");
  });
});

describe("Archiv-Header-Prüfung", () => {
  it("akzeptiert ein Archiv mit Zoom 14 und Testpunkt im Rechteck", () => {
    expect(() => validateHeader(header, 11.0825, 49.4456)).not.toThrow();
  });

  it("lehnt Punkte außerhalb des Gebiets und fehlende Vektorkacheln ab", () => {
    expect(() => validateHeader(header, 2.35, 48.85)).toThrow("außerhalb des abgedeckten Gebiets");
    expect(() => validateHeader({ ...header, tileType: 2 }, 11.0825, 49.4456)).toThrow("Vektorkacheln");
  });
});

describe("Dekodierung der Ebene defibrillators", () => {
  it("zählt nur die Features der gewünschten Ebene", () => {
    expect(countLayerFeatures(encodeTile({ defibrillators: 2, other: 5 }))).toBe(2);
  });

  it("meldet eine fehlende Ebene als null statt als leeren Befund", () => {
    expect(countLayerFeatures(encodeTile({ other: 3 }))).toBeNull();
  });
});

describe("Gesamtablauf mit Fakes", () => {
  function fakeFetch(options: { metadataStatus?: number; rangeStatus?: number; body?: unknown } = {}): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/metadata.json")) {
        return new Response(JSON.stringify(options.body ?? metadata()), { status: options.metadataStatus ?? 200 });
      }
      return new Response(new Uint8Array(127), { status: options.rangeStatus ?? 206, headers: { "Content-Range": "bytes 0-126/9999" } });
    }) as typeof fetch;
  }

  /** Fake-Archiv: liest den Header über die echte Range-Quelle und liefert eine feste Kachel. */
  function fakeArchive(tile: ArrayBuffer | undefined): (source: unknown) => ArchiveReader {
    return (source) => {
      const byteSource = source as { getBytes(offset: number, length: number): Promise<unknown> };
      return {
        async getHeader() {
          await byteSource.getBytes(0, 127);
          return header;
        },
        async getZxy() {
          return tile === undefined ? undefined : { data: tile };
        },
      };
    };
  }

  it("liefert Anzahl und Datenstand bei einem erfolgreichen Lauf", async () => {
    const result = await runLiveSearchCheck({
      latitude: 49.4456,
      longitude: 11.0825,
      nowMs: NOW,
      fetchImpl: fakeFetch(),
      openArchive: fakeArchive(encodeTile({ defibrillators: 3 })),
    });
    expect(result.featureCount).toBe(3);
    expect(result.tile).toEqual({ z: 14, x: 8696, y: 5595 });
  });

  it("meldet eine fehlende Kachel als Fehler, nicht als Befund ohne AED", async () => {
    await expect(runLiveSearchCheck({
      latitude: 49.4456, longitude: 11.0825, nowMs: NOW,
      fetchImpl: fakeFetch(), openArchive: fakeArchive(undefined),
    })).rejects.toThrow("Keine Daten in dieser Kachel");
  });

  it("bricht ab, wenn der Server Range-Anfragen nicht mit 206 beantwortet", async () => {
    await expect(runLiveSearchCheck({
      latitude: 49.4456, longitude: 11.0825, nowMs: NOW,
      fetchImpl: fakeFetch({ rangeStatus: 200 }), openArchive: fakeArchive(encodeTile({ defibrillators: 1 })),
    })).rejects.toThrow("Range-Anfrage");
  });

  it("meldet einen HTTP-Fehler der Metadaten klar", async () => {
    await expect(runLiveSearchCheck({
      latitude: 49.4456, longitude: 11.0825, nowMs: NOW,
      fetchImpl: fakeFetch({ metadataStatus: 503 }), openArchive: fakeArchive(encodeTile({ defibrillators: 1 })),
    })).rejects.toThrow("HTTP 503");
  });
});

describe("readLimited (Größenbegrenzung beim Lesen)", () => {
  it("liefert eine Antwort innerhalb der Grenze vollständig zurück", async () => {
    const bytes = await readLimited(new Response(new Uint8Array([1, 2, 3])), 3);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("bricht den Datenstrom ab, sobald die Grenze überschritten ist, statt alles zu laden", async () => {
    // Der Fake-Server würde endlos Daten liefern. Nur ein stückweises Lesen mit Abbruch
    // kann hier überhaupt fertig werden; ein komplettes Einlesen würde nie enden.
    let delivered = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) { delivered += 1; controller.enqueue(new Uint8Array(1_024)); },
      cancel() { cancelled = true; },
    });
    await expect(readLimited(new Response(endless), 4_096)).rejects.toThrow("größer als erlaubt");
    expect(cancelled).toBe(true);
    expect(delivered).toBeLessThan(20);
  });

  it("lehnt eine zu groß angekündigte Antwort ab, ohne den Inhalt zu lesen", async () => {
    const response = new Response(new Uint8Array(10), { headers: { "Content-Length": "999999" } });
    await expect(readLimited(response, 100)).rejects.toThrow("größer als erlaubt");
  });
});

// ---------------------------------------------------------------------------
// Gleichlauf mit der Worker-Route
// ---------------------------------------------------------------------------
// Das Skript läuft ohne TypeScript-Build und hat deshalb Kopien der Konstanten aus
// server/osm/staticCandidateSearchRoute.ts. Dieser Test liest beide Quelltexte als reinen Text
// und vergleicht die Werte. Ändert jemand die Route, ohne das Skript anzupassen, wird der Test rot,
// und der Live-Check prüft nicht mehr dasselbe wie die App.
describe("Konstanten des Live-Checks stimmen mit der Worker-Route überein", () => {
  /** Liest den Ausdruck rechts von `const NAME =` (bis zum Semikolon) aus einem Quelltext. */
  function constantExpression(source: string, name: string): string {
    const match = source.match(new RegExp(`^const ${name} = (.+?);\\s*$`, "m"));
    if (!match) throw new Error(`Konstante ${name} nicht gefunden`);
    // Leerzeichen vereinheitlichen, damit Formatierungsunterschiede nicht stören.
    return match[1].replace(/\s+/g, " ").trim();
  }

  it.each([
    "DATA_ORIGIN",
    "PMTILES_PATH",
    "AED_LAYER",
    "AED_ZOOM",
    "MAX_SOURCE_AGE_HOURS",
    "MAX_TILE_BYTES",
    "MAX_METADATA_BYTES",
    "REQUIRED_EXTRACTS",
    "EXTRACT_STATUSES",
  ])("%s ist in Skript und Route gleich", (name) => {
    expect(constantExpression(scriptSource, name)).toBe(constantExpression(routeSource, name));
  });

  it("die DACH-Grenzen des Skripts entsprechen der Prüfung in der Route", () => {
    // Route: bounds.minLat >= 45 && bounds.maxLat <= 56 ...; Skript: COVERAGE_BOUNDS.
    const routeBounds = routeSource.match(/bounds\.minLat >= (\d+)\s*&&\s*bounds\.maxLat <= (\d+)\s*&&\s*bounds\.minLon >= (\d+)\s*&&\s*bounds\.maxLon <= (\d+)/);
    const scriptBounds = scriptSource.match(/COVERAGE_BOUNDS = \{ minLat: (\d+), maxLat: (\d+), minLon: (\d+), maxLon: (\d+) \}/);
    expect(routeBounds, "Prüfung in der Route nicht gefunden").not.toBeNull();
    expect(scriptBounds, "COVERAGE_BOUNDS im Skript nicht gefunden").not.toBeNull();
    expect(scriptBounds!.slice(1)).toEqual(routeBounds!.slice(1));
  });
});
