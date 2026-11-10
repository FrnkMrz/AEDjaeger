#!/usr/bin/env node
/**
 * Lesender Live-Check der AED-Datenquelle.
 *
 * Was das Skript tut: Es liest die Metadaten des PMTiles-Archivs von OpenFireMap,
 * prüft Datenstand und Abdeckung, lädt genau eine Zoom-14-Kachel an einer
 * Testkoordinate per HTTP Range und zählt die Features der Ebene `defibrillators`.
 *
 * Was es NICHT tut: Es schreibt nichts. Es sendet nur GET- bzw. Range-Anfragen an
 * pipeline.openfiremap.org, verändert weder OpenStreetMap, noch Cloudflare, noch die
 * Datenpipeline und gibt keine Kandidatendetails aus.
 *
 * Wichtig für die Auswertung: Eine fehlende Kachel oder fehlende Ebene wird als
 * Fehler gemeldet. Sie beweist nie, dass an dieser Stelle kein AED existiert.
 *
 * Konstanten: Die wenigen Werte unten sind absichtlich aus
 * server/osm/staticCandidateSearchRoute.ts kopiert, weil dieses Skript ohne
 * TypeScript-Build läuft. Ändert sich dort etwas (URL, Metadatenfelder, Altersgrenze,
 * Zoom, Layername), muss dieses Skript im selben Schritt angepasst werden.
 *
 * Aufruf: npm run check:live-search -- [--lat 49.4456] [--lon 11.0825]
 * Exit-Code 0 bei Erfolg, 1 bei jedem Fehler.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles } from "pmtiles";

// --- Werte aus server/osm/staticCandidateSearchRoute.ts (bitte synchron halten) ---
const DATA_ORIGIN = "https://pipeline.openfiremap.org/";
const PMTILES_PATH = "openfiremap.pmtiles";
const AED_LAYER = "defibrillators";
const AED_ZOOM = 14;
// 5 Tage (120 Stunden), wie in der Route. Produktentscheidung vom 10.11.2026.
const MAX_SOURCE_AGE_HOURS = 5 * 24;
const MAX_TILE_BYTES = 1 * 1_024 * 1_024;
const MAX_METADATA_BYTES = 256 * 1_024;
const REQUIRED_EXTRACTS = ["germany", "austria", "switzerland", "luxembourg", "liechtenstein"];
const EXTRACT_STATUSES = new Set(["fresh_download", "downloaded_dated", "cached_head_ok", "downloaded"]);
// Die Route akzeptiert Suchbereiche nur innerhalb dieses Rechtecks (DACH).
const COVERAGE_BOUNDS = { minLat: 45, maxLat: 56, minLon: 5, maxLon: 18 };
// ---------------------------------------------------------------------------------

// Nur für dieses Skript: Gesamtzeit für Metadaten, Header und Kachel.
const TIMEOUT_MS = 20_000;
// Erwartete Standardkoordinate: Nürnberg Hauptbahnhof (dicht besiedelt, typischer AED-Standort).
const DEFAULT_LATITUDE = 49.4456;
const DEFAULT_LONGITUDE = 11.0825;
const FUTURE_TOLERANCE_MS = 60_000;
const USAGE = "Aufruf: npm run check:live-search -- [--lat <Breite>] [--lon <Länge>]";

/** Fachlich erwarteter Fehler mit deutscher Meldung für die Ausgabe. */
export class LiveCheckError extends Error {}

/**
 * Liest --lat und --lon aus der Kommandozeile. Ohne Angaben gilt die Standardkoordinate.
 * Zahlen werden streng geprüft, damit „NaN“, „1e3“ oder leere Werte nicht durchrutschen.
 */
export function parseCliArguments(argv) {
  const values = { lat: String(DEFAULT_LATITUDE), lon: String(DEFAULT_LONGITUDE) };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [name, inlineValue] = argument.split(/=(.*)/su, 2);
    if (name !== "--lat" && name !== "--lon") throw new LiveCheckError(`Unbekannte Option: ${name}. ${USAGE}`);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (value === undefined) throw new LiveCheckError(`Option ${name} braucht einen Wert.`);
    values[name.slice(2)] = value;
  }
  return parseCoordinate(Number(values.lat), Number(values.lon), values);
}

function parseCoordinate(latitude, longitude, raw) {
  if (!/^-?\d+(\.\d+)?$/u.test(raw.lat) || !/^-?\d+(\.\d+)?$/u.test(raw.lon)) {
    throw new LiveCheckError("Breite und Länge müssen einfache Dezimalzahlen sein, zum Beispiel 49.4456.");
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new LiveCheckError("Die Breite muss zwischen -90 und 90 liegen.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new LiveCheckError("Die Länge muss zwischen -180 und 180 liegen.");
  return { latitude, longitude };
}

/** Rechnet eine Koordinate in die XYZ-Kachel des Zooms um (Web-Mercator, wie in der Route). */
export function tileForCoordinate(longitude, latitude, zoom) {
  const size = 2 ** zoom;
  // Web-Mercator ist oberhalb von etwa ±85,05 Grad nicht definiert; wir klemmen die Breite.
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = clampedLatitude * Math.PI / 180;
  return {
    z: zoom,
    x: Math.max(0, Math.min(size - 1, Math.floor((longitude + 180) / 360 * size))),
    y: Math.max(0, Math.min(size - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size))),
  };
}

/**
 * Prüft die Metadaten wie die Route: Format, Herkunftsregion, Datenalter und die
 * Länderextrakte. Veraltete oder unvollständige Metadaten sind ein Fehler, keine Warnung.
 */
export function validateMetadata(value, nowMs) {
  if (!isRecord(value) || value.status !== "ok" || value.region !== "dachlilu"
    || typeof value.generated_at !== "string" || typeof value.osm_data_until !== "string"
    || !isRecord(value.pmtiles) || value.pmtiles.file !== PMTILES_PATH
    || !Number.isSafeInteger(value.pmtiles.size_bytes) || value.pmtiles.size_bytes < 127
    || !isRecord(value.features) || !isRecord(value.features.defibrillators)
    || !Number.isSafeInteger(value.features.defibrillators.count) || value.features.defibrillators.count < 0
    || !isRecord(value.extracts)) {
    throw new LiveCheckError("metadata.json ist unvollständig oder hat nicht das erwartete Format.");
  }
  const generatedAt = parseTimestamp(value.generated_at);
  const osmDataUntil = parseTimestamp(value.osm_data_until);
  if (generatedAt === null || osmDataUntil === null || generatedAt > nowMs + FUTURE_TOLERANCE_MS) {
    throw new LiveCheckError("metadata.json enthält ungültige oder zukünftige Zeitstempel.");
  }
  if (osmDataUntil > nowMs + FUTURE_TOLERANCE_MS) throw new LiveCheckError("osm_data_until liegt in der Zukunft.");
  const ageHours = ageInHours(osmDataUntil, nowMs);
  if (ageHours > MAX_SOURCE_AGE_HOURS) {
    throw new LiveCheckError(`Der OSM-Datenstand ist ${formatHours(ageHours)} Stunden alt (Grenze ${MAX_SOURCE_AGE_HOURS} Stunden). Die App würde die Suche deshalb sperren.`);
  }
  for (const country of REQUIRED_EXTRACTS) {
    const extract = value.extracts[country];
    const sourceDate = isRecord(extract) ? parseTimestamp(extract.osm_data_timestamp) : null;
    if (!isRecord(extract) || !EXTRACT_STATUSES.has(String(extract.status)) || sourceDate === null
      || sourceDate > nowMs + FUTURE_TOLERANCE_MS || ageInHours(sourceDate, nowMs) > MAX_SOURCE_AGE_HOURS) {
      throw new LiveCheckError(`Länderextrakt „${country}“ fehlt, ist unvollständig oder veraltet.`);
    }
  }
  return {
    buildTime: value.generated_at,
    osmDataUntil: value.osm_data_until,
    ageHours,
    featureCount: value.features.defibrillators.count,
  };
}

/** Prüft den PMTiles-Header: Vektorkacheln, Zoom 14 enthalten, Testpunkt im Archivrechteck. */
export function validateHeader(header, longitude, latitude) {
  if (header.tileType !== 1) throw new LiveCheckError("Das Archiv enthält keine Vektorkacheln (MVT).");
  if (header.minZoom > AED_ZOOM || header.maxZoom < AED_ZOOM) {
    throw new LiveCheckError(`Das Archiv deckt Zoom ${AED_ZOOM} nicht ab (Bereich ${header.minZoom}–${header.maxZoom}).`);
  }
  const insideArchive = longitude >= header.minLon && longitude <= header.maxLon
    && latitude >= header.minLat && latitude <= header.maxLat;
  const insideCoverage = longitude >= COVERAGE_BOUNDS.minLon && longitude <= COVERAGE_BOUNDS.maxLon
    && latitude >= COVERAGE_BOUNDS.minLat && latitude <= COVERAGE_BOUNDS.maxLat;
  if (!insideArchive || !insideCoverage) {
    throw new LiveCheckError("Die Testkoordinate liegt außerhalb des abgedeckten Gebiets (DACH). Die App würde hier keine Suche starten.");
  }
}

/**
 * Zählt die Features der Ebene `defibrillators` in einer Kachel.
 * Gibt null zurück, wenn die Ebene in dieser Kachel fehlt.
 */
export function countLayerFeatures(tileBytes) {
  const tile = new VectorTile(new PbfReader(new Uint8Array(tileBytes)));
  if (!Object.hasOwn(tile.layers, AED_LAYER)) return null;
  return tile.layers[AED_LAYER].length;
}

/**
 * Gesamtablauf des Checks. fetchImpl und openArchive sind injizierbar, damit der
 * Test ohne Netz laufen kann. Standardmäßig werden echte Anfragen gesendet.
 */
export async function runLiveSearchCheck({
  latitude,
  longitude,
  fetchImpl = fetch,
  openArchive = (source) => new PMTiles(source),
  nowMs = Date.now(),
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const metadataUrl = new URL("metadata.json", DATA_ORIGIN);
    const metadataResponse = await requestOrFail(fetchImpl, metadataUrl, { Accept: "application/json" }, controller.signal);
    if (!metadataResponse.ok) throw new LiveCheckError(`metadata.json antwortete mit HTTP ${metadataResponse.status}.`);
    const metadataText = new TextDecoder("utf-8", { fatal: true }).decode(await readLimited(metadataResponse, MAX_METADATA_BYTES));
    const metadata = validateMetadata(JSON.parse(metadataText), nowMs);

    // Wie in der Route: Der Build-Zeitstempel als Parameter verhindert Mischungen alter Kacheln.
    const archiveUrl = new URL(PMTILES_PATH, DATA_ORIGIN);
    archiveUrl.searchParams.set("v", metadata.buildTime);
    const source = new RangeSource(archiveUrl, fetchImpl, controller.signal);
    const archive = openArchive(source);

    const header = await archive.getHeader();
    validateHeader(header, longitude, latitude);

    const tile = tileForCoordinate(longitude, latitude, AED_ZOOM);
    const content = await archive.getZxy(tile.z, tile.x, tile.y, controller.signal);
    if (!content) {
      throw new LiveCheckError(`Keine Daten in dieser Kachel (Zoom ${tile.z}, ${tile.x}/${tile.y}). Das beweist nicht, dass hier kein AED existiert.`);
    }
    if (content.data.byteLength > MAX_TILE_BYTES) throw new LiveCheckError("Die Kachel ist größer als erlaubt.");
    const featureCount = countLayerFeatures(content.data);
    if (featureCount === null) {
      throw new LiveCheckError(`Die Ebene „${AED_LAYER}“ fehlt in dieser Kachel. Das beweist nicht, dass hier kein AED existiert.`);
    }
    return { metadata, tile, featureCount };
  } catch (error) {
    if (error instanceof LiveCheckError) throw error;
    if (controller.signal.aborted) throw new LiveCheckError(`Zeitüberschreitung nach ${TIMEOUT_MS / 1_000} Sekunden.`);
    throw new LiveCheckError(`Netzwerk- oder Lesefehler (${error?.cause?.code ?? error?.message ?? "unbekannt"}). Das ist kein Befund über vorhandene oder fehlende AEDs.`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Byte-Quelle für PMTiles. Sie akzeptiert nur eine echte 206-Antwort mit passendem
 * Content-Range. Ignoriert der Server Range, würde sonst das ganze Archiv geladen.
 */
class RangeSource {
  constructor(archiveUrl, fetchImpl, signal) {
    this.archiveUrl = archiveUrl;
    this.fetchImpl = fetchImpl;
    this.signal = signal;
  }

  getKey() { return this.archiveUrl.href; }

  async getBytes(offset, length, signal) {
    const end = offset + length - 1;
    const response = await requestOrFail(this.fetchImpl, this.archiveUrl, {
      Accept: "application/octet-stream", Range: `bytes=${offset}-${end}`,
    }, signal ?? this.signal);
    if (response.status !== 206 || response.headers.get("Content-Range")?.startsWith(`bytes ${offset}-${end}/`) !== true) {
      throw new LiveCheckError(`Range-Anfrage wurde nicht korrekt beantwortet (HTTP ${response.status}).`);
    }
    const bytes = await readLimited(response, length);
    if (bytes.byteLength !== length) throw new LiveCheckError("Die Range-Antwort hat eine unerwartete Länge.");
    const data = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(data).set(bytes);
    return { data, etag: response.headers.get("ETag") ?? undefined };
  }
}

/** GET mit verbotener Weiterleitung. Eine Weiterleitung würde den Herkunftsschutz umgehen. */
async function requestOrFail(fetchImpl, url, headers, signal) {
  return fetchImpl(url, { method: "GET", headers, redirect: "error", signal });
}

/**
 * Liest eine Antwort nur bis zur erlaubten Größe, damit ein falscher Server nicht viel Speicher belegt.
 *
 * Wichtig: Wir lesen den Datenstrom stückweise und brechen sofort ab, sobald die Grenze
 * überschritten ist. `response.arrayBuffer()` würde dagegen erst die komplette Antwort
 * herunterladen und die Größe erst danach prüfen – dann wäre die Grenze wirkungslos.
 * Das Vorgehen entspricht `readLimitedBody` in server/osm/staticCandidateSearchRoute.ts.
 */
export async function readLimited(response, maxBytes) {
  const tooLarge = () => new LiveCheckError("Die Antwort ist größer als erlaubt.");
  // Schneller Vorab-Check: Kündigt der Server schon eine zu große Antwort an, lesen wir gar nicht erst.
  const announcedLength = response.headers.get("Content-Length");
  if (announcedLength !== null && (!/^\d+$/u.test(announcedLength) || Number(announcedLength) > maxBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        // Verbindung beenden, statt den Rest der übergroßen Antwort noch zu laden.
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  // Die gesammelten Teilstücke zu einem zusammenhängenden Byte-Feld zusammensetzen.
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseTimestamp(value) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageInHours(timeMs, nowMs) {
  return (nowMs - timeMs) / 3_600_000;
}

function formatHours(hours) {
  return hours.toFixed(1).replace(".", ",");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printSuccess({ metadata, tile, featureCount }) {
  console.log("Live-Check bestanden (nur lesend).");
  console.log(`Build: ${metadata.buildTime}`);
  console.log(`OSM-Datenstand bis: ${metadata.osmDataUntil} (Alter ${formatHours(metadata.ageHours)} Stunden, Grenze ${MAX_SOURCE_AGE_HOURS} Stunden)`);
  console.log(`Kachel Zoom ${tile.z}, ${tile.x}/${tile.y}: ${featureCount} Features in der Ebene „${AED_LAYER}“.`);
  console.log("Hinweis: Das ist eine Stichprobe an einer einzelnen Koordinate, kein Nachweis für die ganze Region.");
}

async function main(argv) {
  let point;
  try {
    point = parseCliArguments(argv);
  } catch (error) {
    console.error(`FEHLER: ${error.message}`);
    console.error(USAGE);
    return 1;
  }
  try {
    const result = await runLiveSearchCheck({ ...point, fetchImpl: fetch });
    printSuccess(result);
    return 0;
  } catch (error) {
    const message = error instanceof LiveCheckError ? error.message : "Unerwarteter Fehler beim Live-Check.";
    console.error(`FEHLER: ${message}`);
    return 1;
  }
}

// Nur ausführen, wenn das Skript direkt gestartet wird (nicht beim Import durch Tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
