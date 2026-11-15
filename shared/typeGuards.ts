/** Shared runtime guard for untrusted JSON values in browser and Worker code. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
