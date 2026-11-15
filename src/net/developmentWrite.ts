import type { DevelopmentWriteRequest } from "../domain/workflow";

export type DevelopmentWriteHttpResult = {
  ok: boolean;
  status: number;
  payload: unknown;
};

/**
 * Send one already confirmed write proposal to the isolated OSM development routes.
 *
 * This module owns only the HTTP boundary: route selection, wire-format mapping and JSON
 * decoding. It deliberately does not decide whether the response means success, conflict,
 * retry or recovery. Those decisions update the photo workflow state and stay in `main.ts`.
 * That separation keeps uncertain-write recovery behavior visible at its current owner.
 */
export async function sendDevelopmentWrite(
  request: DevelopmentWriteRequest,
  recoveryIdentity: string | undefined,
): Promise<DevelopmentWriteHttpResult> {
  const isCheckDate = request.kind === "check-date";
  const response = await fetch(isCheckDate ? "/api/osm/development/check-date" : "/api/osm/development/create-node", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify(
      isCheckDate
        ? {
            recovery_identity: recoveryIdentity,
            operation_id: request.operationId,
            confirmed: true,
            target: request.target,
            expected_version: request.expectedVersion,
            expected_check_date: request.expectedCheckDate,
            observed_on: request.observedOn,
            // Ohne Detailangaben bleibt das bisherige Requestformat samt Abgleichswert unverändert.
            ...(request.details && Object.keys(request.details).length > 0 ? { details: request.details } : {}),
            // Korrekturen übertragen den vorher bestätigten Altwert für die serverseitige Konfliktprüfung.
            ...(request.expectedBefore && request.confirmedCorrections === true
              ? { expected_before: request.expectedBefore, confirmed_corrections: true }
              : {}),
          }
        : {
            recovery_identity: recoveryIdentity,
            operation_id: request.operationId,
            confirmed: true,
            absence_confirmed: true,
            latitude: request.latitude,
            longitude: request.longitude,
            observed_on: request.observedOn,
            details: request.details,
            confirmed_different_candidate_ids: request.confirmedDifferentCandidateIds,
          },
    ),
  });

  // JSON decoding remains inside this boundary. A malformed or interrupted response throws and
  // the caller conservatively keeps the operation in the existing uncertain/recovery path.
  const payload: unknown = await response.json();
  return { ok: response.ok, status: response.status, payload };
}
