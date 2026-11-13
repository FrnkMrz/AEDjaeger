import { assessCandidateSearch } from "./assessCandidateSearch";
import type { CandidateAssessment, Coordinate, LocationEstimate, MatchPolicy } from "./candidateMatch";
import type { DetailTags } from "../contracts/aedDetails";
import type { ExistingNode, ExistingNodeErrorCode } from "../osm/existingNode";
import type { CandidateSearchResult } from "../osm/candidateTypes";
import type { SearchLocation } from "../osm/candidateSearch";
import type { ExistingCheckDatePreview, NewAedPreview, ProposalResult } from "./osmChangeProposal";

export type DemoScenario = "existing" | "new" | "multiple" | "unclear" | "search-error" | "upload-unclear";
export type ProposalKind = "existing" | "new";
export type CandidateId = "main-entrance" | "sports-hall";

export type CandidateResultState = {
  kind: "candidate-result";
  photoUrl: string;
  search: CandidateSearchResult;
  assessment: CandidateAssessment;
  location: SearchLocation;
  /** Explicitly records that the person reviewed all nearby entries and none is this AED. */
  noneOfTheseConfirmed?: boolean;
  /**
   * Erste von zwei Bestätigungen für eine Neuanlage nach einer Suche ohne Treffer:
   * Die Person hat ausdrücklich gewählt, dass hier ein AED fehlt und neu eingetragen werden soll.
   */
  newEntryRequested?: boolean;
  retryAvailableAt?: number;
};

export type DevelopmentWriteRequest = {
  operationId: string;
  candidateLabel: string;
} & (
  // details (optional): Detailtags, die ERGÄNZT werden sollen. Dann ist expectedVersion die Version, die die Person frisch gesehen hat.
  | { kind: "check-date"; target: string; expectedVersion?: number; expectedCheckDate: string | null; observedOn: string; details?: DetailTags }
  // details: die geprüften Detailtags (siehe src/contracts/aedDetails.ts). Leer, wenn die Person nichts angegeben hat.
  | { kind: "create-node"; latitude: number; longitude: number; observedOn: string; details: DetailTags; confirmedDifferentCandidateIds: string[] }
);

/** Ladezustand des frischen AED-Stands beim Ergänzen von Angaben. */
export type ExistingAedLoad =
  | { status: "loading" }
  | { status: "error"; code: ExistingNodeErrorCode }
  | { status: "ready"; node: ExistingNode };

export type FlowState =
  | { kind: "ready" }
  // photoCheck "unavailable": Die automatische Fotoprüfung ist gescheitert; die Person bestätigt dann selbst.
  // photoCheckCode: kurzer Hinweis zur Ursache des Fehlschlags (nur Anzeige, siehe VisionClientError.detail).
  | { kind: "photo"; photoUrl: string; photoCheck?: "unavailable"; photoCheckCode?: string }
  // Das Foto wird (nach ausdrücklichem Tippen) zur Prüfung an OpenAI gesendet.
  | { kind: "photo-checking"; photoUrl: string }
  // Die Prüfung hat „kein AED“ oder „nicht eindeutig“ gemeldet: Standard ist „Anderes Foto“. Als Ausnahme für
  // Fehlurteile geht es nur nach zwei ausdrücklichen Bestätigungen weiter.
  // overrideStep "confirm": Die Person hat „Trotzdem: Hier ist ein AED“ getippt und muss es noch einmal bestätigen.
  | { kind: "photo-rejected"; photoUrl: string; reason: "not-aed" | "unclear"; overrideStep?: "confirm" }
  | { kind: "photo-date"; photoUrl: string; suggestedDate: string }
  | { kind: "analyzing"; photoUrl: string }
  | { kind: "location-choice"; photoUrl: string }
  | { kind: "location-map"; photoUrl: string; center: LocationEstimate; initialZoom?: number }
  | { kind: "candidate-searching"; photoUrl: string }
  | CandidateResultState
  // Detailformular für eine Neuanlage (Entscheidung vom 13.11.2026). Die Person hat Suche und Position bestätigt (erste Bestätigung);
  // hier gibt sie freiwillige Angaben ein. Die eingegebenen Werte liegen im Arbeitsspeicher von main.ts (detailForm), damit sie
  // beim Neuzeichnen und beim Zurückgehen erhalten bleiben. position ist der bestätigte Kartenpunkt.
  | { kind: "new-aed-details"; photoUrl: string; returnState: CandidateResultState; position: Coordinate }
  // detailsPosition ist nur gesetzt, wenn die Vorschau aus dem Detailformular kommt: Dann führt „Zurück“ dorthin statt zur Suche.
  | { kind: "new-aed-preview"; photoUrl: string; result: ProposalResult<NewAedPreview>; returnState: CandidateResultState; detailsPosition?: Coordinate; writeStatus?: "sending" | "complete" | "uncertain" | "conflict" | "failed"; operationId?: string }
  // Angaben zu einem bestehenden AED ergänzen (Etappe P4). Erst wird der aktuelle Stand frisch aus OSM geladen (load), dann
  // zeigt das Formular, was schon eingetragen ist (gesperrt), und lässt nur Fehlendes ausfüllen.
  | { kind: "existing-aed-details"; photoUrl: string; candidateId: string; candidateLabel: string; returnState: CandidateResultState; load: ExistingAedLoad }
  // details/node sind nur gesetzt, wenn die Vorschau aus dem Ergänzen-Formular kommt: details sind die neuen Tags, node der frisch gelesene Stand.
  | { kind: "osm-preview"; photoUrl: string; candidateId: string; candidateLabel: string; result: ProposalResult<ExistingCheckDatePreview>; returnState: CandidateResultState; details?: DetailTags; node?: ExistingNode; writeStatus?: "sending" | "complete" | "unchanged" | "uncertain" | "conflict" | "failed"; operationId?: string }
  | { kind: "development-write-recovery"; request: DevelopmentWriteRequest; writeStatus: "uncertain" | "sending" | "complete" | "unchanged" | "conflict" | "failed" }
  | { kind: "candidate-error"; photoUrl: string; reason: "location-unavailable" | "location-denied" | "location-uncertain" | "sign-in" | "rate-limited" | "service-unavailable" | "failed" | "invalid-response"; retryAvailableAt?: number }
  | { kind: "clarification"; photoUrl: string; reason: "sign-only" | "multiple" }
  | { kind: "proposal"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "sending"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "checking-status"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "saved"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "unclear-error"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "retryable-error"; photoUrl: string; reason: "search" };

const demoLocation: LocationEstimate = {
  latitude: 52.52,
  longitude: 13.405,
  accuracyMeters: 10,
};
const demoMatchPolicy: MatchPolicy = {
  nearbyRadiusMeters: 100,
  maximumAccuracyMeters: 100,
};

// Fixed candidates model the dedicated AED feed. Classification comes from the
// feed contract, so these fixtures do not invent an emergency tag absent from its allowlist.
function demoCandidate(id: string, latitude: number, longitude: number, name: string) {
  return {
    id, osmType: "node" as const, coordinateQuality: "exact" as const,
    position: { latitude, longitude }, tags: { name },
  };
}
const demoSearchResponses: Record<DemoScenario, CandidateSearchResult> = {
  existing: { status: "complete", coverageRadiusMeters: 110, candidates: [demoCandidate("node/154", 52.52001, 13.40501, "Demo AED am Haupteingang")] },
  new: { status: "complete", coverageRadiusMeters: 110, candidates: [] },
  multiple: { status: "complete", coverageRadiusMeters: 110, candidates: [
    demoCandidate("node/154", 52.52001, 13.40501, "Demo AED Haupteingang"),
    demoCandidate("node/256", 52.51999, 13.40499, "Demo AED Sporthalle"),
  ] },
  unclear: { status: "complete", coverageRadiusMeters: 110, candidates: [] },
  "search-error": { status: "failed", coverageRadiusMeters: 0, candidates: [], reason: "coverage-unavailable" },
  "upload-unclear": { status: "complete", coverageRadiusMeters: 110, candidates: [demoCandidate("node/154", 52.52001, 13.40501, "Demo AED am Haupteingang")] },
};

function mapCandidateAssessment(
  assessment: CandidateAssessment,
  photoUrl: string,
): Extract<FlowState, { kind: "proposal" | "clarification" | "retryable-error" }> {
  switch (assessment.kind) {
    case "candidate-review":
      return assessment.candidates.length > 1
        ? { kind: "clarification", photoUrl, reason: "multiple" }
        : { kind: "proposal", photoUrl, proposal: "existing" };
    case "new-entry-eligible":
      return { kind: "proposal", photoUrl, proposal: "new" };
    default:
      // Partial, failed, or unusable search data stays retryable; it never suggests a new AED.
      return { kind: "retryable-error", photoUrl, reason: "search" };
  }
}

// Demo scenarios use the same conservative matcher as live static-feed results.
export function analysisResult(
  scenario: DemoScenario,
  photoUrl: string,
): Extract<FlowState, { kind: "proposal" | "clarification" | "retryable-error" }> {
  if (scenario === "unclear") {
    return { kind: "clarification", photoUrl, reason: "sign-only" };
  }

  const search = demoSearchResponses[scenario];
  const { assessment } = assessCandidateSearch(demoLocation, search, demoMatchPolicy);
  return mapCandidateAssessment(assessment, photoUrl);
}

// A nearby match is not unique until the person recognizes the correct location.
export function chooseCandidate(state: FlowState, candidateId: CandidateId): FlowState {
  if (state.kind !== "clarification" || state.reason !== "multiple") return state;
  return { kind: "proposal", photoUrl: state.photoUrl, proposal: "existing", candidateId };
}

// This prototype only demonstrates the flow. It has no OSM client or save operation.
export function confirmationResult(
  scenario: DemoScenario,
  photoUrl: string,
  proposal: ProposalKind,
  candidateId?: CandidateId,
): FlowState {
  if (scenario === "upload-unclear") return { kind: "unclear-error", photoUrl, proposal, candidateId };
  return { kind: "saved", photoUrl, proposal, candidateId };
}

// The demo simulates a server-side lookup confirming that its earlier save succeeded.
export function recoveryResult(state: Extract<FlowState, { kind: "unclear-error" }>): FlowState {
  return { kind: "saved", photoUrl: state.photoUrl, proposal: state.proposal, candidateId: state.candidateId };
}
