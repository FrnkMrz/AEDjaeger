import { describe, expect, it } from "vitest";
import { analysisResult, chooseCandidate, confirmationResult, recoveryResult } from "../src/domain/workflow";

describe("simulated AED workflow", () => {
  const photoUrl = "blob:test-photo";

  it("offers a new entry only after a successful empty search", () => {
    expect(analysisResult("new", photoUrl)).toEqual({ kind: "proposal", photoUrl, proposal: "new" });
    expect(analysisResult("search-error", photoUrl)).toEqual({ kind: "retryable-error", photoUrl, reason: "search" });
  });

  it("lets the person select a nearby candidate before confirming it", () => {
    const clarification = analysisResult("multiple", photoUrl);
    expect(clarification).toEqual({ kind: "clarification", photoUrl, reason: "multiple" });
    expect(chooseCandidate(clarification, "sports-hall")).toEqual({
      kind: "proposal", photoUrl, proposal: "existing", candidateId: "sports-hall",
    });
    expect(chooseCandidate(analysisResult("unclear", photoUrl), "sports-hall")).toEqual(
      analysisResult("unclear", photoUrl),
    );
  });

  it("asks for clarification for sign-only photos", () => {
    expect(analysisResult("unclear", photoUrl)).toEqual({ kind: "clarification", photoUrl, reason: "sign-only" });
  });

  it("preserves the selected photo for every analysis outcome", () => {
    const scenarios = ["existing", "new", "multiple", "unclear", "search-error", "upload-unclear"] as const;
    for (const scenario of scenarios) expect(analysisResult(scenario, photoUrl)).toHaveProperty("photoUrl", photoUrl);
  });

  it("keeps an uncertain save separate from a confirmed result", () => {
    const uncertain = confirmationResult("upload-unclear", photoUrl, "existing", "main-entrance");
    expect(uncertain).toEqual({ kind: "unclear-error", photoUrl, proposal: "existing", candidateId: "main-entrance" });
    if (uncertain.kind !== "unclear-error") throw new Error("Expected an uncertain save result.");
    expect(recoveryResult(uncertain)).toEqual({ kind: "saved", photoUrl, proposal: "existing", candidateId: "main-entrance" });
    expect(confirmationResult("existing", photoUrl, "existing")).toEqual({ kind: "saved", photoUrl, proposal: "existing" });
  });
});
