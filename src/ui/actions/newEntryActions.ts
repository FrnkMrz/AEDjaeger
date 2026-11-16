import type { buildDetailTags, DetailTags } from "../../contracts/aedDetails";
import type { CandidateResultState, FlowState } from "../../domain/workflow";
import type { Coordinate } from "../../map/positionPicker";

type NewAedPreviewResult = Extract<FlowState, { kind: "new-aed-preview" }>["result"];

type NewEntryActionContext = {
  state: FlowState;
  setState: (state: FlowState) => void;
  newEntryPanelOpen: (state: CandidateResultState) => boolean;
  readPositionConfirmed: () => boolean;
  clearExistingDetailTags: () => void;
  newAedPositionOverride: Coordinate | undefined;
  computePreview: (
    state: CandidateResultState,
    positionConfirmed: boolean,
    details?: DetailTags,
  ) => NewAedPreviewResult;
  buildDetails: typeof buildDetailTags;
  getDetailForm: () => Parameters<typeof buildDetailTags>[0];
  updateDetailFooter: () => void;
};

export type NewEntryActionResult = "unhandled" | "handled" | "stop";

/** Keep new-entry state transitions together; DOM and persistence work stays in main.ts. */
export function handleNewEntryAction(action: string | undefined, context: NewEntryActionContext): NewEntryActionResult {
  const { state, setState } = context;

  if (action === "preview-new-aed" && state.kind === "candidate-result") {
    if (!context.newEntryPanelOpen(state)) return "stop";
    if (context.readPositionConfirmed()) {
      // A stale existing-node read must never block opening the new-entry form.
      context.clearExistingDetailTags();
      const confirmedPosition = context.newAedPositionOverride ?? state.location;
      setState({
        kind: "new-aed-details",
        photoUrl: state.photoUrl,
        returnState: state,
        position: { latitude: confirmedPosition.latitude, longitude: confirmedPosition.longitude },
      });
    } else {
      // Show the locked preview so the person can see why position confirmation is still required.
      setState({
        kind: "new-aed-preview",
        photoUrl: state.photoUrl,
        result: context.computePreview(state, false),
        returnState: state,
      });
    }
    return "handled";
  }

  if (action === "details-continue" && state.kind === "new-aed-details") {
    const built = context.buildDetails(context.getDetailForm());
    if (!built.ok) {
      context.updateDetailFooter();
      return "stop";
    }
    setState({
      kind: "new-aed-preview",
      photoUrl: state.photoUrl,
      result: context.computePreview(state.returnState, true, built.tags),
      returnState: state.returnState,
      detailsPosition: state.position,
    });
    return "handled";
  }

  if (action === "back-from-details" && state.kind === "new-aed-details") {
    // Preserve form input if the person returns to the position confirmation and continues again.
    setState(state.returnState);
    return "handled";
  }

  if (action === "back-to-details" && state.kind === "new-aed-preview" && state.detailsPosition) {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return "stop";
    setState({
      kind: "new-aed-details",
      photoUrl: state.photoUrl,
      returnState: state.returnState,
      position: state.detailsPosition,
    });
    return "handled";
  }

  if (action === "back-to-search" && state.kind === "new-aed-preview") {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return "stop";
    setState(state.returnState);
    return "handled";
  }

  return "unhandled";
}
