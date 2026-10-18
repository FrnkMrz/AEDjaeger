export type DemoScenario = "existing" | "new" | "multiple" | "unclear" | "search-error" | "upload-unclear";
export type ProposalKind = "existing" | "new";
export type CandidateId = "main-entrance" | "sports-hall";

export type FlowState =
  | { kind: "ready" }
  | { kind: "photo"; photoUrl: string }
  | { kind: "analyzing"; photoUrl: string }
  | { kind: "clarification"; photoUrl: string; reason: "sign-only" | "multiple" }
  | { kind: "proposal"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "sending"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "checking-status"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "saved"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "unclear-error"; photoUrl: string; proposal: ProposalKind; candidateId?: CandidateId }
  | { kind: "retryable-error"; photoUrl: string; reason: "search" };

// A failed surrounding-area search must never be interpreted as proof that no AED exists.
export function analysisResult(
  scenario: DemoScenario,
  photoUrl: string,
): Extract<FlowState, { kind: "proposal" | "clarification" | "retryable-error" }> {
  switch (scenario) {
    case "existing":
      return { kind: "proposal", photoUrl, proposal: "existing" };
    case "new":
      return { kind: "proposal", photoUrl, proposal: "new" };
    case "multiple":
      return { kind: "clarification", photoUrl, reason: "multiple" };
    case "unclear":
      return { kind: "clarification", photoUrl, reason: "sign-only" };
    case "search-error":
      return { kind: "retryable-error", photoUrl, reason: "search" };
    case "upload-unclear":
      return { kind: "proposal", photoUrl, proposal: "existing" };
  }
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
