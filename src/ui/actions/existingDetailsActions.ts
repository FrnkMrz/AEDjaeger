import type { DetailPlanResult, DetailTags } from "../../contracts/aedDetails";
import { previewExistingAedCheck } from "../../domain/osmChangeProposal";
import type { FlowState } from "../../domain/workflow";
import type { PhotoSessionState } from "../../state/photoSession";

type ExistingDetailsActionContext = {
  state: FlowState;
  source?: HTMLElement;
  observedOn: PhotoSessionState["observedOn"];
  developmentWriteEnabled: boolean;
  /** Echtes OSM (Etappe Q4): Ergänzen erlaubt, aber nur für frisch gelesene Treffer mit Version. */
  productionDetailsEnabled: boolean;
  setState: (state: FlowState) => void;
  resetDetailForm: () => void;
  setExistingTags: (tags: DetailTags | undefined) => void;
  loadExistingAedNode: (candidateId: string) => void;
  currentDetailPlan: () => DetailPlanResult;
  updateDetailFooter: () => void;
};

export type ExistingDetailsActionResult = "unhandled" | "handled" | "stop";

/** Keep existing-AED detail navigation together while leaving fetching and form state in the app controller. */
export function handleExistingDetailsAction(
  action: string | undefined,
  context: ExistingDetailsActionContext,
): ExistingDetailsActionResult {
  const { state, setState } = context;

  if (action === "open-existing-details" && state.kind === "osm-preview" && !state.node) {
    const candidateId = state.candidateId;
    const candidate = state.returnState.search.candidates.find((item) => item.id === candidateId);
    if (!detailsAllowed(context, candidate) || candidate?.osmType !== "node") return "stop";
    context.resetDetailForm();
    setState({
      kind: "existing-aed-details",
      photoUrl: state.photoUrl,
      candidateId,
      candidateLabel: state.candidateLabel,
      returnState: state.returnState,
      load: { status: "loading" },
    });
    context.loadExistingAedNode(candidateId);
    return "handled";
  }

  if (action === "open-candidate-details" && state.kind === "candidate-result") {
    const candidateId = context.source?.dataset.candidateId;
    const candidate = state.search.candidates.find((item) => item.id === candidateId);
    if (!candidateId || !candidate || candidate.osmType !== "node" || !detailsAllowed(context, candidate))
      return "stop";
    context.resetDetailForm();
    const candidateLabel = candidate.tags.name || candidate.tags["defibrillator:location"] || "";
    setState({
      kind: "existing-aed-details",
      photoUrl: state.photoUrl,
      candidateId,
      candidateLabel,
      returnState: state,
      load: { status: "loading" },
      fromList: true,
    });
    context.loadExistingAedNode(candidateId);
    return "handled";
  }

  if (action === "existing-details-retry" && state.kind === "existing-aed-details" && state.load.status === "error") {
    setState({ ...state, load: { status: "loading" } });
    context.loadExistingAedNode(state.candidateId);
    return "handled";
  }

  if (
    action === "existing-details-continue" &&
    state.kind === "existing-aed-details" &&
    state.load.status === "ready"
  ) {
    const plan = context.currentDetailPlan();
    if (!plan.ok) {
      context.updateDetailFooter();
      return "stop";
    }
    const node = state.load.node;
    const result = previewExistingAedCheck(
      { id: state.candidateId, osmType: "node", tags: node.tags },
      true,
      context.observedOn,
    );
    setState({
      kind: "osm-preview",
      photoUrl: state.photoUrl,
      candidateId: state.candidateId,
      candidateLabel: state.candidateLabel,
      result,
      returnState: state.returnState,
      node,
      ...(state.fromList ? { fromList: true as const } : {}),
      ...(Object.keys(plan.tags).length > 0 ? { details: plan.tags } : {}),
      ...(plan.corrections.length > 0 ? { corrections: plan.corrections } : {}),
    });
    return "handled";
  }

  if (action === "back-from-existing-details" && state.kind === "existing-aed-details") {
    // Discard form values: OSM may change before the person returns to edit these details.
    const { candidateId, candidateLabel, returnState, photoUrl } = state;
    const candidate = returnState.search.candidates.find((item) => item.id === candidateId);
    const cameFromList = state.fromList === true;
    context.resetDetailForm();
    if (!candidate || cameFromList) {
      setState(returnState);
    } else {
      setState({
        kind: "osm-preview",
        photoUrl,
        candidateId,
        candidateLabel,
        result: previewExistingAedCheck(candidate, true, context.observedOn),
        returnState,
      });
    }
    return "handled";
  }

  if (action === "back-to-existing-details" && state.kind === "osm-preview" && state.node) {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return "stop";
    context.setExistingTags(state.node.tags);
    setState({
      kind: "existing-aed-details",
      photoUrl: state.photoUrl,
      candidateId: state.candidateId,
      candidateLabel: state.candidateLabel,
      returnState: state.returnState,
      load: { status: "ready", node: state.node },
      ...(state.fromList ? { fromList: true as const } : {}),
    });
    return "handled";
  }

  return "unhandled";
}

/**
 * Darf für diesen Treffer das Formular „Angaben ergänzen“ öffnen?
 *  - Testserver: wie bisher, nur nicht für Treffer aus dem Archiv des echten OSM.
 *  - Echtes OSM (Etappe Q4): nur für Treffer, die frisch von der OSM-API kamen und eine Version tragen.
 */
function detailsAllowed(
  context: { developmentWriteEnabled: boolean; productionDetailsEnabled: boolean },
  candidate: { source?: string; version?: number } | undefined,
): boolean {
  if (!candidate) return false;
  if (context.productionDetailsEnabled) return candidate.source === "live" && candidate.version !== undefined;
  return context.developmentWriteEnabled && candidate.source !== "archive";
}
