import type { CandidateAssessment, Coordinate, LocationEstimate } from "./candidateMatch";
import type { DetailCorrection, DetailTags } from "../contracts/aedDetails";
import type { ExistingNode, ExistingNodeErrorCode } from "../osm/existingNode";
import type { CandidateSearchResult } from "../osm/candidateTypes";
import type { SearchLocation } from "../osm/candidateSearch";
import type { ExistingCheckDatePreview, NewAedPreview, ProposalResult } from "./osmChangeProposal";


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
  | { kind: "check-date"; target: string; expectedVersion?: number; expectedCheckDate: string | null; observedOn: string; details?: DetailTags; expectedBefore?: Record<string, string>; confirmedCorrections?: true }
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
  | { kind: "existing-aed-details"; photoUrl: string; candidateId: string; candidateLabel: string; returnState: CandidateResultState; load: ExistingAedLoad; fromList?: true }
  // details/node sind nur gesetzt, wenn die Vorschau aus dem Ergänzen-Formular kommt: details sind die neuen Tags, node der frisch gelesene Stand.
  | { kind: "osm-preview"; photoUrl: string; candidateId: string; candidateLabel: string; result: ProposalResult<ExistingCheckDatePreview>; returnState: CandidateResultState; details?: DetailTags; corrections?: DetailCorrection[]; node?: ExistingNode; fromList?: true; writeStatus?: "sending" | "complete" | "unchanged" | "notFound" | "uncertain" | "conflict" | "failed"; operationId?: string }
  | { kind: "development-write-recovery"; request: DevelopmentWriteRequest; writeStatus: "uncertain" | "sending" | "complete" | "unchanged" | "notFound" | "conflict" | "failed" }
  | { kind: "candidate-error"; photoUrl: string; reason: "location-unavailable" | "location-denied" | "location-uncertain" | "sign-in" | "rate-limited" | "service-unavailable" | "failed" | "invalid-response"; retryAvailableAt?: number }
