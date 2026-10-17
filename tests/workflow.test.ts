import { describe, expect, it } from "vitest";
import { analysisResult, confirmationResult } from "../src/domain/workflow";

describe("simulated AED workflow", () => {
  it("offers a new entry only after a successful empty search", () => {
    expect(analysisResult("new")).toMatchObject({ kind: "proposal", proposal: "new" });
    expect(analysisResult("search-error")).toMatchObject({ kind: "retryable-error", reason: "search" });
  });

  it("asks for clarification for multiple candidates and sign-only photos", () => {
    expect(analysisResult("multiple")).toMatchObject({ kind: "clarification", reason: "multiple" });
    expect(analysisResult("unclear")).toMatchObject({ kind: "clarification", reason: "sign-only" });
  });

  it("keeps an uncertain save separate from a confirmed result", () => {
    expect(confirmationResult("upload-unclear", "blob:photo", "existing")).toEqual({ kind: "unclear-error", photoUrl: "blob:photo" });
    expect(confirmationResult("existing", "blob:photo", "existing")).toEqual({ kind: "saved", photoUrl: "blob:photo", proposal: "existing" });
  });
});
