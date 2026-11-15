import { CONFIRM_RADIUS_METERS } from "../../domain/matchPolicy";
import type { FlowState } from "../../domain/workflow";
import { displayCandidateLabel } from "../markup";
import type { StatusContentContext } from "./statusContent";

type CandidateResultContext = Omit<StatusContentContext, "state"> & {
  state: Extract<FlowState, { kind: "candidate-result" }>;
};

export function renderCandidateResult(context: CandidateResultContext): string {
  const {
    state,
    tv,
    escapeHtml,
    photoMarkup,
    developmentSession,
    developmentWriteAvailable,
    developmentWriteOwnerHash,
    developmentCorrectionsAvailable,
    newAedPositionOverride,
    searchLocationSource,
    newEntryPanelOpen,
  } = context;
  const { assessment, search } = state;
  const photoSession = { searchLocationSource };
  const candidatesToShow: Array<{ candidate: (typeof search.candidates)[number]; distanceMeters?: number }> = [];
  if (assessment.kind === "candidate-review") {
    for (const rankedCandidate of assessment.candidates) {
      const candidate = search.candidates.find((item) => item.id === rankedCandidate.id);
      if (candidate) candidatesToShow.push({ candidate, distanceMeters: rankedCandidate.distanceMeters });
    }
  } else if (assessment.kind === "search-incomplete") {
    for (const candidate of search.candidates) candidatesToShow.push({ candidate });
  }
  // Nur bei einer vollständigen Trefferprüfung gibt es Kartenmarker; dann bekommt jeder
  // Listeneintrag dieselbe Nummer wie sein Marker auf der Karte.
  const numbered = assessment.kind === "candidate-review";
  const candidates = candidatesToShow
    .map(({ candidate, distanceMeters }, index) => {
      const name = displayCandidateLabel(
        candidate.tags.name || candidate.tags["defibrillator:location"] || "",
        tv("unnamedAed"),
      );
      const label = numbered ? `${index + 1}. ${name}` : name;
      const distance =
        distanceMeters === undefined
          ? ""
          : `<span>${escapeHtml(tv("distance", { distance: Math.round(distanceMeters) }))}</span>`;
      // Zwei Stufen (siehe src/domain/matchPolicy.ts): Bis 10 m ist es ein Treffer zum Bestätigen. Zwischen 10 und
      // 50 m steht nur ein Hinweis mit der Entfernung; der AED muss vor einer Neuanlage geprüft werden, lässt sich
      // aber nicht als "noch vorhanden" bestätigen.
      const tooFarToConfirm = distanceMeters !== undefined && distanceMeters > CONFIRM_RADIUS_METERS;
      // Zweiter Weg direkt aus der Liste: Angaben ansehen und ergänzen (bzw. ändern), bevor das Datum bestätigt wird. Das
      // Datum folgt am Ende mit einem Speichern für alles. Nur für AEDs, die es auf dem Testserver gibt: Ein AED aus dem
      // Archiv des echten OSM existiert dort nicht und lässt sich nicht bearbeiten.
      const detailsAction =
        developmentSession && developmentWriteAvailable && developmentWriteOwnerHash && candidate.source !== "archive"
          ? `<button class="button button-secondary" data-action="open-candidate-details" data-candidate-id="${escapeHtml(candidate.id)}">${tv(developmentCorrectionsAvailable ? "candidateDetailsChange" : "candidateDetailsView")}</button>`
          : "";
      const reviewAction =
        candidate.osmType !== "node"
          ? `<span class="supporting-copy">${tv("previewUnsupportedShort")}</span>`
          : tooFarToConfirm
            ? `<span class="supporting-copy">${tv("candidateTooFar", { meters: CONFIRM_RADIUS_METERS })}</span>`
            : `<button class="button button-secondary" data-action="preview-candidate" data-candidate-id="${escapeHtml(candidate.id)}">${tv("selectCandidate")}</button>${detailsAction}`;
      return `<li class="candidate-item"><strong>${escapeHtml(label)}</strong>${distance}${reviewAction}</li>`;
    })
    .join("");
  let outcome: string;
  if (search.status === "partial" || assessment.kind === "search-incomplete") outcome = tv("searchPartial");
  else if (assessment.kind === "candidate-review") outcome = tv("searchFound", { count: assessment.candidates.length });
  else if (assessment.kind === "new-entry-eligible") outcome = tv("searchNoMatch");
  else if (assessment.kind === "location-too-uncertain") outcome = tv("locationUncertain");
  else outcome = tv("searchFailedResult");
  const selectedPosition = newAedPositionOverride ?? state.location;
  const mayPrepareNewEntry = newEntryPanelOpen(state);
  const newEntryAction = mayPrepareNewEntry
    ? `<section class="position-picker-panel" aria-labelledby="new-aed-position-title"><h3 id="new-aed-position-title">${tv("newPositionMapLabel")}</h3><p class="position-picker-help">${tv("newPositionMapHelp")}</p><div id="new-aed-position-map" class="position-map" role="application" tabindex="0" aria-label="${tv("newPositionMapLabel")}" aria-describedby="new-position-map-instructions"></div><p class="sr-only" id="new-position-map-instructions">${tv("mapNavigationHelp")}</p><p class="position-map-coordinates" id="new-aed-position-coordinates" aria-live="polite">${tv("newPreviewCoordinates", { latitude: selectedPosition.latitude.toFixed(5), longitude: selectedPosition.longitude.toFixed(5) })}</p><div class="position-confirmation"><label for="new-aed-position-confirmed"><input id="new-aed-position-confirmed" type="checkbox" /><span id="new-aed-position-label">${tv("newPositionConfirm", { latitude: selectedPosition.latitude.toFixed(5), longitude: selectedPosition.longitude.toFixed(5) })}</span></label><button class="button button-primary" data-action="preview-new-aed">${tv("newPreviewAction")}</button></div></section>`
    : "";
  // Erste von zwei Bestätigungen für eine Neuanlage (siehe newEntryPanelOpen):
  // Erst dieser bewusste Tastendruck öffnet Karte und Positionsbestätigung.
  const startNewEntry =
    search.status !== "complete" || mayPrepareNewEntry
      ? ""
      : assessment.kind === "candidate-review"
        ? `<button class="button button-quiet" data-action="none-of-these">${tv("noneMatchAction")}</button>`
        : assessment.kind === "new-entry-eligible"
          ? `<button class="button button-quiet" data-action="start-new-entry">${tv("newEntryStart")}</button>`
          : "";
  // Übersichtskarte: zeigt den gesuchten Standort (roter Punkt) und die nummerierten Treffer.
  // Sie entfällt, sobald der Neuanlage-Bereich offen ist – dessen Karte zeigt dieselben Marker.
  const overviewMap =
    numbered && candidatesToShow.length > 0 && !mayPrepareNewEntry
      ? `<div id="candidate-overview-map" class="position-map" role="application" tabindex="0" aria-label="${tv("overviewMapLabel")}" aria-describedby="overview-map-instructions"></div><p class="sr-only" id="overview-map-instructions">${tv("mapNavigationHelp")}</p><p class="position-map-privacy">${tv("overviewMapLegend")}</p>`
      : "";
  const retryWaitSeconds =
    state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
  const retry =
    search.status === "partial" || assessment.kind === "search-incomplete"
      ? retryWaitSeconds > 0
        ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
        : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`
      : "";
  const locationSource =
    photoSession.searchLocationSource === "photo"
      ? "locationSourcePhoto"
      : photoSession.searchLocationSource === "map"
        ? "locationSourceMap"
        : "locationSourcePhone";
  // Bewusst keine technische Zeile mehr zu Datenstand und Snapshot-Kennung: Sie half bei der
  // Fehlersuche, aber nicht der Person vor Ort. Zu alte Daten sperrt der Server ohnehin.
  return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("searchTitle")}</h2><p>${escapeHtml(outcome)}</p><p class="supporting-copy">${tv(locationSource)}</p>${overviewMap}${candidates ? `<ul class="candidate-list">${candidates}</ul>` : ""}</div></div>${newEntryAction}${retry}${startNewEntry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
}
