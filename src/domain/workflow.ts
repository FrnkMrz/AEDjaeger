export type DemoScenario = "existing" | "new" | "multiple" | "unclear" | "search-error" | "upload-unclear";
export type ProposalKind = "existing" | "new";

export type FlowState =
  | { kind: "ready" }
  | { kind: "photo"; photoUrl: string }
  | { kind: "analyzing"; photoUrl: string }
  | { kind: "clarification"; photoUrl: string; reason: "sign-only" | "multiple" }
  | { kind: "proposal"; photoUrl: string; proposal: ProposalKind }
  | { kind: "sending"; photoUrl: string; proposal: ProposalKind }
  | { kind: "saved"; photoUrl: string; proposal: ProposalKind }
  | { kind: "unclear-error"; photoUrl: string }
  | { kind: "retryable-error"; photoUrl: string; reason: "search" };

// A failed surrounding-area search must never be interpreted as proof that no AED exists.
export function analysisResult(scenario: DemoScenario): Extract<FlowState, { kind: "proposal" | "clarification" | "retryable-error" }> {
  switch (scenario) {
    case "existing":
      return { kind: "proposal", photoUrl: "", proposal: "existing" };
    case "new":
      return { kind: "proposal", photoUrl: "", proposal: "new" };
    case "multiple":
      return { kind: "clarification", photoUrl: "", reason: "multiple" };
    case "unclear":
      return { kind: "clarification", photoUrl: "", reason: "sign-only" };
    case "search-error":
      return { kind: "retryable-error", photoUrl: "", reason: "search" };
    case "upload-unclear":
      return { kind: "proposal", photoUrl: "", proposal: "existing" };
  }
}

// This prototype only demonstrates the flow. It has no OSM client or save operation.
export function confirmationResult(scenario: DemoScenario, photoUrl: string, proposal: ProposalKind): FlowState {
  if (scenario === "upload-unclear") return { kind: "unclear-error", photoUrl };
  return { kind: "saved", photoUrl, proposal };
}
