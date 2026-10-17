import { describe, expect, it } from "vitest";
import { analysisResult, confirmationResult } from "../src/domain/workflow";

describe("simulated AED workflow", () => {
  const photoUrl = "blob:test-photo";

  it("offers a new entry only after a successful empty search", () => {
    expect(analysisResult("new", photoUrl)).toEqual({ kind: "proposal", photoUrl, proposal: "new" });
    expect(analysisResult("search-error", photoUrl)).toEqual({ kind: "retryable-error", photoUrl, reason: "search" });
  });

  it("asks for clarification for multiple candidates and sign-only photos", () => {
    expect(analysisResult("multiple", photoUrl)).toEqual({ kind: "clarification", photoUrl, reason: "multiple" });
    expect(analysisResult("unclear", photoUrl)).toEqual({ kind: "clarification", photoUrl, reason: "sign-only" });
  });

  it("preserves the selected photo for every analysis outcome", () => {
    const scenarios = ["existing", "new", "multiple", "unclear", "search-error", "upload-unclear"] as const;
    for (const scenario of scenarios) expect(analysisResult(scenario, photoUrl)).toHaveProperty("photoUrl", photoUrl);
  });

  it("keeps an uncertain save separate from a confirmed result", () => {
    expect(confirmationResult("upload-unclear", photoUrl, "existing")).toEqual({ kind: "unclear-error", photoUrl });
    expect(confirmationResult("existing", photoUrl, "existing")).toEqual({ kind: "saved", photoUrl, proposal: "existing" });
  });
});
