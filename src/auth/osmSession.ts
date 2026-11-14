/** Public session state returned by the Worker; it contains no OSM token or profile data. */
export type OSMSessionStatus = {
  authenticated: boolean;
  loginAvailable: boolean;
  developmentLoginAvailable: boolean;
  developmentSession: boolean;
  developmentWriteAvailable: boolean;
  /** HMAC-gebundene, nicht zurückrechenbare Kennung zum Fortsetzen von Testserver-Vorgängen nach OAuth-Rotation. */
  developmentWriteOwnerHash?: string;
  /** true nur, wenn der Betreiber Korrekturen bestehender Detailwerte freigegeben hat (und das Schreiben auf dem Testserver an ist). */
  developmentCorrectionsAvailable: boolean;
  /** true nur, wenn die Fotoprüfung für dieses Konto aktiv ist (Betreiber-Konfiguration). */
  photoCheckAvailable: boolean;
};

/** Fail closed when the Worker is unreachable or returns an unexpected response. */
export async function loadOSMSession(fetcher: typeof fetch = fetch): Promise<OSMSessionStatus> {
  const response = await fetcher("/api/auth/session", { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("OSM session status is unavailable.");

  const payload: unknown = await response.json();
  if (!isSessionStatus(payload)) throw new Error("OSM session status is invalid.");
  // Older local preview fixtures may omit this capability. Missing must mean
  // disabled so a stale response can never expose a test-server write action.
  // Dasselbe gilt für die Fotoprüfung: Ein fehlendes Feld bedeutet „aus“, damit die App nie
  // einen Foto-Upload anbietet, den der Server nicht ausdrücklich freigegeben hat.
  // Auch Korrekturen gelten nur bei genau `true`: Ein fehlendes oder fremdes Feld heißt „aus“.
  return {
    ...payload,
    developmentWriteAvailable: payload.developmentWriteAvailable === true,
    developmentCorrectionsAvailable: payload.developmentCorrectionsAvailable === true,
    photoCheckAvailable: payload.photoCheckAvailable === true,
  };
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
  return typeof status.authenticated === "boolean" && typeof status.loginAvailable === "boolean" && typeof status.developmentLoginAvailable === "boolean"
    && typeof status.developmentSession === "boolean"
    && (status.developmentWriteAvailable === undefined || typeof status.developmentWriteAvailable === "boolean")
    && (status.developmentWriteOwnerHash === undefined || typeof status.developmentWriteOwnerHash === "string" && /^[a-f0-9]{64}$/u.test(status.developmentWriteOwnerHash))
    && (status.developmentCorrectionsAvailable === undefined || typeof status.developmentCorrectionsAvailable === "boolean")
    && (status.photoCheckAvailable === undefined || typeof status.photoCheckAvailable === "boolean");
}
