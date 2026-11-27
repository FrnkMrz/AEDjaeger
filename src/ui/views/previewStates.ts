import { levelLeftBehindByIndoorChange } from "../../contracts/aedDetails";
import { PRODUCTION_CHANGESET_COMMENTS } from "../../contracts/changesetComment";
import { formatCalendarDate } from "../../domain/localDate";
import type { FlowState } from "../../domain/workflow";
import { displayCandidateLabel } from "../markup";
import type { StatusContentContext } from "./statusContent";

type PreviewState = Extract<FlowState, { kind: "new-aed-preview" | "osm-preview" | "existing-aed-details" }>;
type PreviewContext = Omit<StatusContentContext, "state"> & { state: PreviewState };

export function renderPreviewState(context: PreviewContext): string {
  const {
    state,
    tv,
    escapeHtml,
    photoMarkup,
    developmentSession,
    developmentWriteAvailable,
    developmentWriteOwnerHash,
    developmentCorrectionsAvailable,
    developmentWriteStatusKeys,
    productionWriteAvailable,
    productionWriteStatusKeys,
    productionNewAedsAvailable,
    searchLocationSource,
    isRecoveryOwnerMismatch,
    detailEverythingPresent,
    detailFormMarkup,
    detailFooterMarkup,
    language,
  } = context;
  switch (state.kind) {
    case "new-aed-preview": {
      const point = state.result.kind === "ready" ? state.result.position : state.returnState.location;
      const latitude = point.latitude.toFixed(5);
      const longitude = point.longitude.toFixed(5);
      // Nach dem bestätigten Speichern ist das keine Vorschau mehr: Überschrift und Beschriftungen sagen „gespeichert“,
      // und die Aufforderung „Prüfe Position und Umgebung genau“ entfällt, weil es nichts mehr zu prüfen gibt.
      const savedNew = state.writeStatus === "complete";
      const cautionMarkup = savedNew
        ? ""
        : `<p>${state.result.kind === "ready" && state.result.confirmedDifferentCandidateIds.length > 0 ? tv("newPreviewReviewedCandidates") : tv("newPreviewCaution")}</p>`;
      const content =
        state.result.kind === "ready"
          ? `<p>${tv(savedNew ? "newSavedCoordinates" : "newPreviewCoordinates", { latitude, longitude })}</p><strong>${tv(savedNew ? "newSavedTags" : "newPreviewTags")}</strong><ul>${Object.entries(
              state.result.tags,
            )
              .map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`)
              .join("")}</ul>${cautionMarkup}`
          : `<p>${tv(state.result.reason === "position-not-confirmed" ? "newPositionRequired" : state.result.reason === "search-found-candidate" ? "newPreviewFoundCandidate" : "newPreviewSearchInvalid")}</p>`;
      const developmentCanCreate =
        developmentSession &&
        developmentWriteAvailable &&
        Boolean(developmentWriteOwnerHash) &&
        state.result.kind === "ready";
      // Echtes OSM (Etappe Q5): nur mit Schalter und nur mit echtem Standort (Foto-GPS oder Handy). Ein selbst gesetzter
      // Kartenpunkt reicht nicht, weil ein neuer AED nur dort eingetragen werden darf, wo die Person ist.
      const realLocation = searchLocationSource !== undefined && searchLocationSource !== "map";
      const productionTarget = !developmentSession && productionNewAedsAvailable;
      const productionCanCreate = productionTarget && realLocation && state.result.kind === "ready";
      const canCreate = developmentCanCreate || productionCanCreate;
      const createStatusKeys = productionTarget ? productionWriteStatusKeys : developmentWriteStatusKeys;
      const statusCopy =
        state.writeStatus === "complete"
          ? tv(productionTarget ? "productionCreated" : "developmentCreated")
          : state.writeStatus
            ? tv(createStatusKeys[state.writeStatus])
            : "";
      // Ein unklarer Vorgang lässt sich nur dort fortsetzen, wo er begann: am echten OSM oder am Testserver.
      const createWritesHere = productionTarget
        ? productionNewAedsAvailable
        : developmentSession && developmentWriteAvailable;
      const blockedRecovery =
        state.writeStatus === "uncertain" && (isRecoveryOwnerMismatch() || !createWritesHere)
          ? `<p class="simulation-note" role="status">${tv(isRecoveryOwnerMismatch() ? "recoveryWrongAccount" : productionTarget || developmentSession ? "recoveryWritesDisabled" : "recoveryNeedSignIn")}</p>`
          : "";
      const writeStatus = state.writeStatus
        ? `<p role="status" class="simulation-note ${state.writeStatus === "complete" ? "save-status-success" : ""}">${statusCopy}</p>${blockedRecovery}`
        : "";
      // Zweite von zwei Bestätigungen für eine Neuanlage: Ohne diesen Haken bleibt der
      // Speichern-Knopf gesperrt. Der Klick-Handler prüft den Haken zusätzlich noch einmal.
      const writeAction =
        canCreate && !state.writeStatus
          ? `${productionCanCreate ? `<p class="simulation-note">${escapeHtml(tv("productionWriteNotice", { comment: PRODUCTION_CHANGESET_COMMENTS.create }))}</p>` : ""}<div class="position-confirmation"><label for="new-aed-absence-confirmed"><input id="new-aed-absence-confirmed" type="checkbox" /><span>${tv("newAbsenceConfirm")}</span></label></div><button class="button button-primary" data-action="create-development-node" disabled>${tv(productionCanCreate ? "productionCreateAction" : "developmentCreateAction")}</button>`
          : state.writeStatus === "uncertain" && state.operationId && !isRecoveryOwnerMismatch()
            ? `<button class="button button-secondary" data-action="retry-development-write">${createWritesHere ? tv(productionTarget ? "productionRetry" : "developmentRetry") : tv("recoveryContinue")}</button>`
            : "";
      // Der Hinweis „nur eine Vorschau“ steht nur, wenn es nichts zu speichern gibt. Mit Speichern-Knopf sagt dessen
      // Beschriftung („Testserver: AED eintragen“) schon, wohin die Änderung geht.
      // Der Hinweis „nur eine Vorschau“ gilt nur, wenn gar nichts gespeichert werden kann und kein Vorgang läuft. Nach einem
      // Speichern (oder währenddessen) wäre er falsch; dann sagt die Statusmeldung, was passiert ist.
      const noWriteNotice =
        !canCreate && !state.writeStatus
          ? `<p class="simulation-note">${tv(productionTarget && !realLocation && state.result.kind === "ready" ? "productionNeedsDeviceLocation" : "previewNoWrite")}</p>`
          : "";
      // „Zurück“ bleibt hier immer: Es führt zur Positionsbestätigung bzw. zur Suche, nicht nur zu Treffern.
      // Kommt die Vorschau aus dem Detailformular, führt „Zurück“ dorthin (die Eingaben bleiben erhalten). Sonst zur Suche.
      const backButton = state.detailsPosition
        ? `<button class="button button-quiet" data-action="back-to-details">${tv("detailsBackToForm")}</button>`
        : `<button class="button button-quiet" data-action="back-to-search">${tv("previewBack")}</button>`;
      const navigation =
        state.writeStatus === "sending" || state.writeStatus === "uncertain"
          ? ""
          : state.writeStatus === "complete"
            ? `<button class="button button-primary" data-action="retake">${tv("nextAed")}</button>`
            : `${backButton}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      // Bei Erfolg steht die Bestätigung direkt unter der Überschrift, damit sie nicht unter der Tag-Liste verschwindet.
      return savedNew
        ? `${photoMarkup}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${tv("newSavedTitle")}</h2>${writeStatus}${content}</div></div>${writeAction}${navigation}`
        : `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("newPreviewTitle")}</h2>${content}${noWriteNotice}${writeStatus}</div></div>${writeAction}${navigation}`;
    }
    case "osm-preview": {
      const { result } = state;
      const candidateId = state.candidateId;
      const candidate = state.returnState.search.candidates.find((item) => item.id === candidateId);
      // Ein AED aus dem Archiv des echten OSM gibt es auf dem Testserver nicht. Dafür gibt es dort keinen Speichern-Knopf.
      const archiveOnly = developmentSession && developmentWriteAvailable && candidate?.source === "archive";
      const developmentCanWrite =
        developmentSession &&
        developmentWriteAvailable &&
        Boolean(developmentWriteOwnerHash) &&
        candidate?.osmType === "node" &&
        result.kind === "ready" &&
        !archiveOnly;
      // Echtes OSM (Etappe Q3): nur das Prüfdatum, nur für einen frisch von der OSM-API gelesenen Treffer ("live") und
      // ohne Detailangaben. Ein Treffer nur aus dem Archiv ist bis zu 5 Tage alt; dafür gibt es keinen Speichern-Knopf.
      const productionCanWrite =
        !developmentSession &&
        productionWriteAvailable &&
        candidate?.osmType === "node" &&
        candidate.source === "live" &&
        // Die Version kommt aus der frischen Suche oder (nach dem Formular) aus dem frisch gelesenen Objekt.
        (state.node !== undefined || candidate.version !== undefined) &&
        result.kind === "ready" &&
        // Ergänzen ja (Q4); bestehende Werte ersetzen nur mit dem Korrektur-Schalter dieser Sitzung (Q6).
        ((state.corrections ?? []).length === 0 || developmentCorrectionsAvailable);
      const canWrite = developmentCanWrite || productionCanWrite;
      const statusKeys =
        productionCanWrite || (!developmentSession && productionWriteAvailable)
          ? productionWriteStatusKeys
          : developmentWriteStatusKeys;
      // Nur das Wesentliche: das neue Prüfdatum. Der bisherige Wert steht nur da, wenn es einen gibt.
      const content =
        result.kind === "ready"
          ? `<p><strong>${tv("previewNewDate", { date: formatCalendarDate(result.changes[0].after, language) })}</strong></p>${result.changes[0].before ? `<p>${tv("previewOldDate", { date: escapeHtml(formatCalendarDate(result.changes[0].before, language)) })}</p>` : ""}`
          : result.reason === "newer-check-date-exists" && result.existingDate
            ? `<p>${tv("previewNewerDate", { date: escapeHtml(formatCalendarDate(result.existingDate, language)) })}</p>`
            : `<p>${tv("previewUnsupported")}</p>`;
      // Kommt die Vorschau aus dem Ergänzen-Formular, stehen hier die neuen Tags. Sie werden vor dem Speichern genau gezeigt.
      const corrections = state.corrections ?? [];
      const correctedKeys = new Set<string>(corrections.map((correction) => correction.key));
      const addedTags = state.details ? Object.entries(state.details).filter(([key]) => !correctedKeys.has(key)) : [];
      const addedList =
        addedTags.length > 0
          ? `<p><strong>${tv("detailsAddedTitle")}</strong></p><ul>${addedTags.map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`).join("")}</ul>`
          : "";
      // Korrekturen als „alt → neu“: Der alte Wert steht durchgestrichen davor. Alle Werte stammen aus OSM oder der Eingabe und werden maskiert.
      const changedList =
        corrections.length > 0
          ? `<p><strong>${tv("detailsChangedTitle")}</strong></p><ul>${corrections.map((correction) => `<li><code>${escapeHtml(correction.key)}=<span class="detail-old">${escapeHtml(correction.before)}</span> → ${escapeHtml(correction.after)}</code></li>`).join("")}</ul>`
          : "";
      // Bleibt nach „draußen“ eine alte Ebene stehen, sagt die Vorschau es offen (AEDjaeger löscht nie etwas).
      const levelLeft =
        state.details && state.node ? levelLeftBehindByIndoorChange(state.node.tags, state.details) : null;
      const levelLeftNote =
        levelLeft === null
          ? ""
          : `<p class="detail-hint">${escapeHtml(tv("detailLevelStays", { level: levelLeft }))}</p>`;
      const productionTexts = statusKeys === productionWriteStatusKeys;
      const completeText =
        corrections.length > 0
          ? tv(productionTexts ? "productionChangesComplete" : "developmentChangesComplete")
          : addedTags.length > 0
            ? tv(productionTexts ? "productionDetailsComplete" : "developmentDetailsComplete")
            : tv(statusKeys.complete);
      const statusText =
        state.writeStatus === "complete" ? completeText : state.writeStatus ? tv(statusKeys[state.writeStatus]) : "";
      const writesHere =
        statusKeys === productionWriteStatusKeys ? productionWriteAvailable : developmentWriteAvailable;
      const blockedRecovery =
        state.writeStatus === "uncertain" && (isRecoveryOwnerMismatch() || !writesHere)
          ? `<p class="simulation-note" role="status">${tv(isRecoveryOwnerMismatch() ? "recoveryWrongAccount" : statusKeys === productionWriteStatusKeys || developmentSession ? "recoveryWritesDisabled" : "recoveryNeedSignIn")}</p>`
          : "";
      const writeStatus = state.writeStatus
        ? `<p role="status" class="simulation-note ${state.writeStatus === "complete" ? "save-status-success" : ""}">${statusText}</p>${blockedRecovery}`
        : "";
      // Echtes OSM: Vor dem Speichern steht offen da, dass die Änderung öffentlich wird, mit genau dem Kommentar, den der
      // Server danach an OSM schickt (gemeinsame Datei src/contracts/changesetComment.ts).
      const productionNotice =
        productionCanWrite && !state.writeStatus
          ? `<p class="simulation-note">${escapeHtml(tv("productionWriteNotice", { comment: corrections.length > 0 ? PRODUCTION_CHANGESET_COMMENTS.corrections : addedTags.length > 0 ? PRODUCTION_CHANGESET_COMMENTS.details : PRODUCTION_CHANGESET_COMMENTS.checkDate }))}</p>`
          : "";
      // Der zweite Weg neben dem Ein-Tipp-Speichern: fehlende Angaben ergänzen. Nur beim einfachen Prüfdatum-Vorschlag.
      const addDetailsButton =
        (developmentCanWrite || productionCanWrite) && !state.writeStatus && !state.node
          ? `<button class="button button-secondary" data-action="open-existing-details">${tv(developmentCorrectionsAvailable ? "detailsCorrectAction" : "detailsAddAction")}</button>`
          : "";
      // Zweite Bestätigung bei Korrekturen: Ohne den Haken „alter Wert stimmt nicht“ bleibt der Speichern-Knopf gesperrt.
      // Der Klick-Handler prüft den Haken zusätzlich noch einmal.
      const correctionConfirmation =
        canWrite && !state.writeStatus && corrections.length > 0
          ? `<div class="position-confirmation"><label for="correction-confirmed"><input id="correction-confirmed" type="checkbox" /><span>${tv("detailsCorrectionConfirm")}</span></label></div>`
          : "";
      const saveLabel = productionCanWrite
        ? tv("productionWriteAction")
        : corrections.length > 0
          ? tv("developmentChangesAction")
          : addedTags.length > 0
            ? tv("developmentDetailsAction")
            : tv("developmentWriteAction");
      const writeAction =
        canWrite && !state.writeStatus
          ? `${correctionConfirmation}<button class="button button-primary" data-action="save-development-check"${corrections.length > 0 ? " disabled" : ""}>${saveLabel}</button>`
          : state.writeStatus === "uncertain" && state.operationId && !isRecoveryOwnerMismatch()
            ? `<button class="button button-secondary" data-action="retry-development-write">${writesHere ? tv(statusKeys === productionWriteStatusKeys ? "productionRetry" : "developmentRetry") : tv("recoveryContinue")}</button>`
            : "";
      // Nur wenn nichts gespeichert werden kann und kein Vorgang läuft; sonst wäre „nur eine Vorschau“ nach einem Speichern falsch.
      // Bei einem neueren Datum in OSM sagt die Meldung selbst, dass nichts geändert wird; „nur eine Vorschau“ wäre doppelt.
      const newerDateInOsm = result.kind === "blocked" && result.reason === "newer-check-date-exists";
      const noWriteNotice =
        !canWrite && !state.writeStatus && !newerDateInOsm
          ? `<p class="simulation-note">${archiveOnly ? tv("previewArchiveNotice") : tv("previewNoWrite")}</p>`
          : "";
      const recoverableWrite = state.writeStatus === "sending" || state.writeStatus === "uncertain";
      // „Zurück“ gibt es nur, wenn es mehrere Treffer zur Auswahl gab. Bei einem einzigen Treffer hätte es keine Bedeutung.
      // Gezählt wird wie in der Trefferliste: Bei „candidate-review“ die bewerteten Treffer, sonst alle Suchtreffer.
      const shownCandidates =
        state.returnState.assessment.kind === "candidate-review"
          ? state.returnState.assessment.candidates.length
          : state.returnState.search.candidates.length;
      const hasOtherCandidates = shownCandidates > 1;
      // Aus dem Ergänzen-Formular führt „Zurück“ dorthin (die Eingaben bleiben), sonst zur Trefferliste.
      const backButton = state.node
        ? `<button class="button button-quiet" data-action="back-to-existing-details">${tv("detailsBackToForm")}</button>`
        : hasOtherCandidates
          ? `<button class="button button-quiet" data-action="back-to-candidates">${tv("previewBack")}</button>`
          : "";
      const navigation = recoverableWrite
        ? ""
        : state.writeStatus === "complete"
          ? `<button class="button button-primary" data-action="retake">${tv("nextAed")}</button>`
          : `${backButton}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      const successful = state.writeStatus === "complete";
      const label = `<p><strong>${escapeHtml(displayCandidateLabel(state.candidateLabel, tv("unnamedAed")))}</strong></p>`;
      // Nach dem bestätigten Speichern: Überschrift „Prüfung gespeichert“ statt „Änderungsvorschau“, Erfolgsmeldung oben.
      return successful
        ? `${photoMarkup}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${tv("checkSavedTitle")}</h2>${writeStatus}${label}${content}${changedList}${addedList}${levelLeftNote}</div></div>${writeAction}${addDetailsButton}${navigation}`
        : `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("previewTitle")}</h2>${label}${content}${changedList}${addedList}${levelLeftNote}${productionNotice}${noWriteNotice}${writeStatus}</div></div>${writeAction}${addDetailsButton}${navigation}`;
    }
    case "existing-aed-details": {
      const label = escapeHtml(displayCandidateLabel(state.candidateLabel, tv("unnamedAed")));
      const header = `<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${tv(developmentCorrectionsAvailable ? "detailsCorrectTitle" : "detailsExistingTitle")}</h2><p><strong>${label}</strong></p><p>${tv(developmentCorrectionsAvailable ? "detailsCorrectIntro" : "detailsExistingIntro")}</p></div></div>`;
      if (state.load.status === "loading") {
        return `${photoMarkup}${header}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("detailLoading")}</span></div>`;
      }
      if (state.load.status === "error") {
        const message =
          state.load.code === "node_unavailable"
            ? tv("detailLoadChanged")
            : state.load.code === "authentication_required"
              ? tv("errorSignIn")
              : tv("detailLoadFailed");
        // Ist der Eintrag weg, hilft Wiederholen nicht; dann bleibt nur der Rückweg.
        const retry =
          state.load.code === "node_unavailable"
            ? ""
            : `<button class="button button-secondary" data-action="existing-details-retry">${tv("detailLoadRetry")}</button>`;
        return `${photoMarkup}${header}<p class="simulation-note" role="alert">${message}</p>${retry}<button class="button button-quiet" data-action="back-from-existing-details">${tv("previewBack")}</button>`;
      }
      const thumbnail = photoMarkup.replace('class="photo-preview"', 'class="photo-preview photo-thumb"');
      const allPresent = detailEverythingPresent() ? `<p class="simulation-note">${tv("detailsAllPresent")}</p>` : "";
      // Das bisherige Prüfdatum aus OSM, damit die Person sieht, wie aktuell der Eintrag ist, bevor sie etwas ändert.
      const lastCheck = state.load.node.tags.check_date
        ? `<p class="supporting-copy">${tv("previewOldDate", { date: escapeHtml(formatCalendarDate(state.load.node.tags.check_date, language)) })}</p>`
        : "";
      return `<div class="detail-form-root">${thumbnail}${header}${lastCheck}${allPresent}<div id="detail-form">${detailFormMarkup()}</div>${detailFooterMarkup()}</div>`;
    }
  }
}
