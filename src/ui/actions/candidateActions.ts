import { previewExistingAedCheck } from "../../domain/osmChangeProposal";
import type { FlowState } from "../../domain/workflow";
import type { Coordinate } from "../../map/positionPicker";
import type { PhotoSessionState } from "../../state/photoSession";

type CandidateActionContext = {
  state: FlowState;
  source?: HTMLElement;
  observedOn: PhotoSessionState["observedOn"];
  setState: (state: FlowState) => void;
  setNewAedPositionOverride: (position: Coordinate | undefined) => void;
};

export type CandidateActionResult = "unhandled" | "handled" | "stop";

/** Simple actions from the candidate list; browser orchestration remains in main.ts. */
export function handleCandidateAction(
  action: string | undefined,
  context: CandidateActionContext,
): CandidateActionResult {
  const { state, source, observedOn, setState, setNewAedPositionOverride } = context;

  if (action === "preview-candidate" && state.kind === "candidate-result") {
    const candidateId = source?.dataset.candidateId;
    const candidate = state.search.candidates.find((item) => item.id === candidateId);
    if (!candidate || !candidateId) return "stop";

    const result = previewExistingAedCheck(candidate, true, observedOn);
    const candidateLabel = candidate.tags.name || candidate.tags["defibrillator:location"] || "";
    setState({
      kind: "osm-preview",
      photoUrl: state.photoUrl,
      candidateId,
      candidateLabel,
      result,
      returnState: state,
    });
    return "handled";
  }

  if (
    action === "none-of-these" &&
    state.kind === "candidate-result" &&
    state.search.status === "complete" &&
    state.assessment.kind === "candidate-review"
  ) {
    // Die Person lehnt alle sichtbaren Nah-Treffer ausdrücklich ab. Vor dem Neuanlegen
    // müssen trotzdem der Punkt auf der Karte und die Suche im Worker bestätigt werden.
    setNewAedPositionOverride(undefined);
    setState({ ...state, noneOfTheseConfirmed: true });
    return "handled";
  }

  if (
    action === "start-new-entry" &&
    state.kind === "candidate-result" &&
    state.search.status === "complete" &&
    state.assessment.kind === "new-entry-eligible"
  ) {
    // Erste Bestätigung bei einer Suche ohne Treffer; danach erscheinen Karte und Positionsbestätigung.
    setNewAedPositionOverride(undefined);
    setState({ ...state, newEntryRequested: true });
    return "handled";
  }

  return "unhandled";
}
