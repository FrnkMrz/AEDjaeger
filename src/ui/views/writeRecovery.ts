import type { FlowState } from "../../domain/workflow";
import { displayCandidateLabel } from "../markup";
import type { StatusContentContext } from "./statusContent";

type RecoveryContext = Omit<StatusContentContext, "state"> & {
  state: Extract<FlowState, { kind: "development-write-recovery" }>;
};

/** Show the recovery state for a saved test-server request without changing it. */
export function renderWriteRecovery(context: RecoveryContext): string {
  const { state, tv, escapeHtml, developmentSession, developmentWriteAvailable, developmentWriteStatusKeys } = context;
  const isRecoveryOwnerMismatch = context.isRecoveryOwnerMismatch;
  const blockedReason =
    state.writeStatus === "uncertain" &&
    (isRecoveryOwnerMismatch() || !developmentSession || !developmentWriteAvailable)
      ? tv(
          isRecoveryOwnerMismatch()
            ? "recoveryWrongAccount"
            : !developmentSession
              ? "recoveryNeedSignIn"
              : "recoveryWritesDisabled",
        )
      : "";
  // Bei einer Neuanlage steht die Position da; bei einem Prüfdatum genügt die Bezeichnung des AED.
  const targetLink =
    state.request.kind === "check-date"
      ? ""
      : `<p>${state.request.latitude.toFixed(5)}, ${state.request.longitude.toFixed(5)}</p>`;
  const recoveryMessage =
    state.request.kind === "create-node" && state.writeStatus === "complete"
      ? tv("developmentCreated")
      : tv(developmentWriteStatusKeys[state.writeStatus]);
  const action =
    state.writeStatus === "uncertain" && isRecoveryOwnerMismatch()
      ? ""
      : state.writeStatus === "uncertain" || state.writeStatus === "sending"
        ? `<button class="button button-primary" data-action="continue-recovery"${state.writeStatus === "sending" ? " disabled" : ""}>${state.writeStatus === "sending" ? tv("developmentSending") : developmentSession && developmentWriteAvailable ? tv("developmentRetry") : tv("recoveryContinue")}</button>`
        : `<button class="button button-primary" data-action="retake">${state.writeStatus === "complete" ? tv("nextAed") : tv("recoveryContinue")}</button>`;
  const successful = state.writeStatus === "complete";
  return `<div class="result-message"><span class="status-icon ${successful ? "status-good" : "status-warn"}" aria-hidden="true">${successful ? "✓" : "!"}</span><div><h2>${tv("previewTitle")}</h2><p><strong>${escapeHtml(displayCandidateLabel(state.request.candidateLabel, tv("unnamedAed")))}</strong></p>${targetLink}<p class="simulation-note ${successful ? "save-status-success" : ""}" role="status">${recoveryMessage}</p>${blockedReason ? `<p class="simulation-note" role="status">${blockedReason}</p>` : ""}</div></div>${action}`;
}
