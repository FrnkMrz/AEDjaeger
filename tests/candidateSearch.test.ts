import { describe, expect, it, vi } from "vitest";
import { CandidateSearchError, requestNearbyCandidates } from "../src/osm/candidateSearch";

describe("nearby candidate client", () => {
  it("does not send coordinates when GPS accuracy exceeds the usable threshold", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(requestNearbyCandidates({ latitude: 52.52, longitude: 13.405, accuracyMeters: 150 }, fetcher))
      .rejects.toMatchObject({ code: "location_too_uncertain" } satisfies Partial<CandidateSearchError>);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
