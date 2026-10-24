/** Public session state returned by the Worker; it contains no OSM token or profile data. */
export type OSMSessionStatus = {
  authenticated: boolean;
  loginAvailable: boolean;
  developmentLoginAvailable: boolean;
};

/** Fail closed when the Worker is unreachable or returns an unexpected response. */
export async function loadOSMSession(fetcher: typeof fetch = fetch): Promise<OSMSessionStatus> {
  const response = await fetcher("/api/auth/session", { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("OSM session status is unavailable.");

  const payload: unknown = await response.json();
  if (!isSessionStatus(payload)) throw new Error("OSM session status is invalid.");
  return payload;
}

/** The logout route is same-origin and accepts POST only. */
export async function endOSMSession(fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("OSM logout failed.");
}

function isSessionStatus(value: unknown): value is OSMSessionStatus {
  if (typeof value !== "object" || value === null) return false;
  const status = value as Record<string, unknown>;
  return typeof status.authenticated === "boolean" && typeof status.loginAvailable === "boolean" && typeof status.developmentLoginAvailable === "boolean";
}
