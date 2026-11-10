// Typen für scripts/check-live-search.mjs, damit Tests es mit TypeScript prüfen können.
// Das Skript selbst bleibt reines Node-ESM ohne Build-Schritt.

export class LiveCheckError extends Error {}

export type CheckPoint = { latitude: number; longitude: number };

export function parseCliArguments(argv: readonly string[]): CheckPoint;

export function tileForCoordinate(
  longitude: number,
  latitude: number,
  zoom: number,
): { z: number; x: number; y: number };

export function validateMetadata(
  value: unknown,
  nowMs: number,
): { buildTime: string; osmDataUntil: string; ageHours: number; featureCount: number };

export function validateHeader(
  header: { tileType: number; minZoom: number; maxZoom: number; minLon: number; minLat: number; maxLon: number; maxLat: number },
  longitude: number,
  latitude: number,
): void;

export function countLayerFeatures(tileBytes: ArrayBuffer): number | null;

/** Liest eine Antwort stückweise und bricht ab, sobald sie größer als maxBytes wird. */
export function readLimited(response: Response, maxBytes: number): Promise<Uint8Array>;

export type ArchiveReader = {
  getHeader(): Promise<Parameters<typeof validateHeader>[0]>;
  getZxy(z: number, x: number, y: number, signal?: AbortSignal): Promise<{ data: ArrayBuffer } | undefined>;
};

export function runLiveSearchCheck(options: {
  latitude: number;
  longitude: number;
  fetchImpl?: typeof fetch;
  openArchive?: (source: unknown) => ArchiveReader;
  nowMs?: number;
}): Promise<{
  metadata: { buildTime: string; osmDataUntil: string; ageHours: number; featureCount: number };
  tile: { z: number; x: number; y: number };
  featureCount: number;
}>;
