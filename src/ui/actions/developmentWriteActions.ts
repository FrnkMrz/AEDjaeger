import { isDetailKey, type DetailTags } from "../../contracts/aedDetails";
import type { DevelopmentWriteRequest, FlowState } from "../../domain/workflow";
import { isChangesetLocale } from "../../contracts/changesetComment";

type DevelopmentWriteActionContext = {
  state: FlowState;
  setState: (state: FlowState) => void;
  developmentSession: boolean;
  developmentWriteAvailable: boolean;
  developmentWriteOwnerHash?: string;
  /** Echtes OSM (Etappe Q3): Sitzung am echten OSM, Schalter an und Kontokennung vorhanden. */
  productionWriteAvailable: boolean;
  productionWriteOwnerHash?: string;
  /** Sprache der App; geht beim echten OSM als `locale` an das Changeset. */
  locale: string;
  accountSignedIn: boolean;
  pendingDevelopmentWrite?: DevelopmentWriteRequest;
  createOperationId?: () => string;
  prepareSuccessSound: () => void;
  hasUnresolvedSave: (state: FlowState) => boolean;
  clearTimers: () => void;
  releasePhoto: () => void;
  redirectToDevelopmentLogin: () => void;
  confirmNewNode: () => boolean;
  confirmCorrections: () => boolean;
  persistPendingWrite: (request: DevelopmentWriteRequest) => void;
  render: (focus?: boolean) => void;
  submit: (request: DevelopmentWriteRequest) => void;
  isRecoveryOwnerMismatch: () => boolean;
  openAccount: () => void;
  focusRecoveryLogin: () => void;
  refreshAccountState: () => Promise<void>;
  readPendingWrite: (operationId?: string) => DevelopmentWriteRequest | undefined;
};

export type DevelopmentWriteActionResult = "unhandled" | "handled" | "stop";

/** Keep test-server write checks and recovery transitions together; network/storage primitives stay in main.ts. */
export async function handleDevelopmentWriteAction(
  action: string | undefined,
  context: DevelopmentWriteActionContext,
): Promise<DevelopmentWriteActionResult> {
  const { state, setState } = context;

  if (
    action === "continue-recovery" &&
    context.pendingDevelopmentWrite &&
    !context.accountSignedIn &&
    !(
      context.pendingDevelopmentWrite.kind === "check-date" &&
      context.pendingDevelopmentWrite.environment === "production"
    )
  ) {
    // Reconcile only after returning to the OSM development session that owns this pending operation.
    context.redirectToDevelopmentLogin();
    return "stop";
  }

  if (action === "retake") {
    if (context.hasUnresolvedSave(state)) return "stop";
    context.clearTimers();
    context.releasePhoto();
    setState(
      context.pendingDevelopmentWrite
        ? { kind: "development-write-recovery", request: context.pendingDevelopmentWrite, writeStatus: "uncertain" }
        : { kind: "ready" },
    );
    return "handled";
  }

  if (action === "create-development-node" && state.kind === "new-aed-preview") {
    context.prepareSuccessSound(); // Unlock on the deliberate tap; play only after confirmed server success.
    const operationIdFactory = context.createOperationId;
    if (
      !context.developmentSession ||
      !context.developmentWriteAvailable ||
      !context.developmentWriteOwnerHash ||
      !operationIdFactory ||
      state.result.kind !== "ready" ||
      state.writeStatus
    )
      return "stop";
    // This confirmation remains a runtime gate even if the disabled button is triggered another way.
    if (!context.confirmNewNode()) return "stop";
    const preview = state;
    if (preview.result.kind !== "ready") return "stop";
    const operationId = operationIdFactory();
    const request: DevelopmentWriteRequest = {
      kind: "create-node",
      operationId,
      candidateLabel: `${preview.result.position.latitude.toFixed(5)}, ${preview.result.position.longitude.toFixed(5)}`,
      latitude: preview.result.position.latitude,
      longitude: preview.result.position.longitude,
      observedOn: preview.result.tags.check_date,
      // The server sets emergency and check_date; only explicitly confirmed detail tags are sent here.
      details: Object.fromEntries(
        Object.entries(preview.result.tags).filter(([key]) => isDetailKey(key)),
      ) as DetailTags,
      confirmedDifferentCandidateIds: preview.result.confirmedDifferentCandidateIds,
    };
    try {
      // Persist the exact proposal before network I/O so an interrupted request can be reconciled safely.
      context.persistPendingWrite(request);
    } catch {
      setState({ ...preview, operationId, writeStatus: "failed" });
      context.render(true);
      return "stop";
    }
    setState({ ...preview, operationId, writeStatus: "sending" });
    context.render(true);
    context.submit(request);
    return "handled";
  }

  if (action === "back-to-candidates" && state.kind === "osm-preview") {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return "stop";
    setState(state.returnState);
    return "handled";
  }

  if (action === "save-development-check" && state.kind === "osm-preview" && !context.developmentSession) {
    // Echtes OSM (Etappe Q3). Dieselben Sicherungen wie beim Testserver, aber enger: nur das Prüfdatum, nur für einen
    // frisch von der OSM-API gelesenen Treffer, keine Detailangaben, keine Korrekturen. Die Prüfung steht hier zusätzlich
    // zur Anzeige, falls der Knopf auf anderem Weg ausgelöst wird.
    context.prepareSuccessSound();
    const operationIdFactory = context.createOperationId;
    if (
      !context.productionWriteAvailable ||
      !context.productionWriteOwnerHash ||
      !operationIdFactory ||
      !isChangesetLocale(context.locale) ||
      state.writeStatus === "sending" ||
      state.writeStatus === "complete" ||
      state.writeStatus === "unchanged" ||
      // Ergänzen ja (Q4); bestehende Werte ersetzen (Korrekturen) gibt es am echten OSM noch nicht.
      (state.corrections ?? []).length > 0
    )
      return "stop";
    const preview = state;
    const candidate = preview.returnState.search.candidates.find((item) => item.id === preview.candidateId);
    // Die frisch gelesene Version ist Pflicht: Nur mit ihr erkennt der Server, ob der AED seit der Vorschau geändert wurde.
    // Maßgeblich ist immer die Version aus der frischen Suche, denn auf ihr beruht die Zuordnung (bis 10 m). Ein im Formular
    // frisch gelesenes Objekt muss genau diese Version haben; sonst könnte es inzwischen verschoben worden sein.
    const expectedVersion = candidate?.version;
    if (preview.node && preview.node.version !== expectedVersion) return "stop";
    if (
      candidate?.osmType !== "node" ||
      candidate.source !== "live" ||
      expectedVersion === undefined ||
      preview.result.kind !== "ready"
    )
      return "stop";
    const operationId = preview.operationId ?? operationIdFactory();
    const change = preview.result.changes[0];
    const request: DevelopmentWriteRequest = {
      kind: "check-date",
      environment: "production",
      locale: context.locale,
      operationId,
      target: candidate.id,
      candidateLabel: preview.candidateLabel,
      expectedVersion,
      expectedCheckDate: change.before,
      observedOn: change.after,
      // Nur Ergänzungen: Der Server schreibt sie nur, wenn jeder dieser Schlüssel am Objekt noch fehlt.
      ...(preview.details && Object.keys(preview.details).length > 0 ? { details: preview.details } : {}),
    };
    try {
      // Vor dem Senden sichern, damit ein Neuladen denselben Vorgang sicher abgleichen kann.
      context.persistPendingWrite(request);
    } catch {
      setState({ ...preview, operationId, writeStatus: "failed" });
      context.render(true);
      return "stop";
    }
    setState({ ...preview, operationId, writeStatus: "sending" });
    context.render(true);
    context.submit(request);
    return "handled";
  }

  if (action === "save-development-check" && state.kind === "osm-preview") {
    context.prepareSuccessSound(); // Unlock on the deliberate tap; play only after confirmed server success.
    const operationIdFactory = context.createOperationId;
    if (
      !context.developmentSession ||
      !context.developmentWriteAvailable ||
      !context.developmentWriteOwnerHash ||
      !operationIdFactory ||
      state.writeStatus === "sending" ||
      state.writeStatus === "complete" ||
      state.writeStatus === "unchanged"
    )
      return "stop";
    const preview = state;
    const candidate = preview.returnState.search.candidates.find((item) => item.id === preview.candidateId);
    if (candidate?.osmType !== "node" || candidate.source === "archive" || preview.result.kind !== "ready")
      return "stop";
    // Replacing existing values requires the separate confirmation in addition to the normal save action.
    const corrections = preview.corrections ?? [];
    if (corrections.length > 0 && !context.confirmCorrections()) return "stop";
    const operationId = preview.operationId ?? operationIdFactory();
    const change = preview.result.changes[0];
    const request: DevelopmentWriteRequest = {
      kind: "check-date",
      operationId,
      target: candidate.id,
      candidateLabel: preview.candidateLabel,
      // A detail preview is based on the version freshly shown to the person.
      ...(preview.node
        ? { expectedVersion: preview.node.version }
        : candidate.version === undefined
          ? {}
          : { expectedVersion: candidate.version }),
      expectedCheckDate: change.before,
      observedOn: change.after,
      ...(preview.details && Object.keys(preview.details).length > 0 ? { details: preview.details } : {}),
      // The server writes corrections only if the values remain exactly as the person saw them.
      ...(corrections.length > 0
        ? {
            expectedBefore: Object.fromEntries(corrections.map((correction) => [correction.key, correction.before])),
            confirmedCorrections: true as const,
          }
        : {}),
    };
    try {
      // Persist the exact confirmed proposal before sending so a reload can reconcile the same operation.
      context.persistPendingWrite(request);
    } catch {
      setState({ ...preview, operationId, writeStatus: "failed" });
      context.render(true);
      return "stop";
    }
    setState({ ...preview, operationId, writeStatus: "sending" });
    context.render(true);
    context.submit(request);
    return "handled";
  }

  if (
    (action === "continue-recovery" || action === "retry-development-write") &&
    (state.kind === "development-write-recovery" || state.kind === "new-aed-preview" || state.kind === "osm-preview")
  ) {
    if (state.writeStatus !== "uncertain" || context.isRecoveryOwnerMismatch()) return "stop";
    const pending =
      state.kind === "development-write-recovery" ? state.request : context.readPendingWrite(state.operationId);
    if (pending?.kind === "check-date" && pending.environment === "production") {
      // Ein Vorgang am echten OSM lässt sich nur in einer Sitzung am echten OSM fortsetzen.
      if (context.developmentSession || !context.accountSignedIn) {
        if (context.accountSignedIn) context.openAccount();
        else context.focusRecoveryLogin();
        return "stop";
      }
      if (!context.productionWriteAvailable || !context.productionWriteOwnerHash) {
        await context.refreshAccountState();
        return "stop";
      }
      context.prepareSuccessSound();
      setState({ ...state, writeStatus: "sending" });
      context.render(true);
      context.submit(pending);
      return "handled";
    }
    if (!context.developmentSession) {
      if (context.accountSignedIn) {
        // A production login cannot reconcile an operation that belongs to the development session.
        context.openAccount();
      } else {
        context.focusRecoveryLogin();
      }
      return "stop";
    }
    if (!context.developmentWriteAvailable || !context.developmentWriteOwnerHash) {
      // Refresh the server switch so this same control can be used after an operator enables test writes.
      await context.refreshAccountState();
      return "stop";
    }
    context.prepareSuccessSound();
    const request =
      state.kind === "development-write-recovery" ? state.request : context.readPendingWrite(state.operationId);
    if (!request) return "stop";
    setState({ ...state, writeStatus: "sending" });
    context.render(true);
    context.submit(request);
    return "handled";
  }

  return "unhandled";
}
