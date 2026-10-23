import { assessOverpassResponse } from "./assessOverpassResponse";
import type { CandidateAssessment, LocationEstimate, MatchPolicy } from "./candidateMatch";
import type { VisionObservation } from "../contracts/visionObservation";

export type DemoScenario = "existing" | "new" | "multiple" | "unclear" | "search-error" | "upload-unclear";
export type ProposalKind = "existing" | "new";
export type CandidateId = "main-entrance" | "sports-hall";

export type FlowState =
  | { kind: "ready" }
  | { kind: "photo"; photoUrl: string }
  | { kind: "analyzing"; photoUrl: string }
  | { kind: "vision-analyzing"; photoUrl: string }
  | { kind: "vision-result"; photoUrl: string; observation: VisionObservation }
  | { kind: "vision-error"; photoUrl: string; reason: "sign-in" | "not-allowed" | "budget" | "unavailable" | "session-unavailable" | "invalid-image" | "failed" | "invalid-response" }
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

// These fixed fixtures exercise the real normalizer and matcher without making a network request.
const demoSearchResponses = {
  existing: {
    elements: [{
      type: "node",
      id: 154,
      lat: 52.52001,
      lon: 13.40501,
      tags: { emergency: "defibrillator" },
    }],
  },
  new: { elements: [] },
  multiple: {
    elements: [
      {
        type: "node",
        id: 154,
        lat: 52.52001,
        lon: 13.40501,
        tags: { emergency: "defibrillator" },
      },
      {
        type: "node",
        id: 256,
        lat: 52.51999,
        lon: 13.40499,
        tags: { emergency: "defibrillator" },
      },
    ],
  },
  "search-error": { elements: [], remark: "Demo: search response is incomplete." },
} as const;

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

// Demo scenarios pass fixtures through the same response validation and matcher used by Overpass.
export function analysisResult(
  scenario: DemoScenario,
  photoUrl: string,
): Extract<FlowState, { kind: "proposal" | "clarification" | "retryable-error" }> {
  if (scenario === "unclear") {
    return { kind: "clarification", photoUrl, reason: "sign-only" };
  }

  const searchScenario = scenario === "upload-unclear" ? "existing" : scenario;
  const payload = demoSearchResponses[searchScenario as keyof typeof demoSearchResponses];
  const { assessment } = assessOverpassResponse(demoLocation, payload, 110, demoMatchPolicy);
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
