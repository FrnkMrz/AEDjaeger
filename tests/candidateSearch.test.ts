import { describe, expect, it, vi } from "vitest";
import { CandidateSearchError, requestNearbyCandidates } from "../src/osm/candidateSearch";

describe("nearby candidate client", () => {
  it("does not send coordinates when GPS accuracy exceeds the usable threshold", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(requestNearbyCandidates({ latitude: 52.52, longitude: 13.405, accuracyMeters: 150 }, fetcher))
      .rejects.toMatchObject({ code: "location_too_uncertain" } satisfies Partial<CandidateSearchError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts a stalled request so the photo flow can offer a retry", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    const pendingSearch = requestNearbyCandidates({ latitude: 52.52, longitude: 13.405, accuracyMeters: 12 }, fetcher);
    const assertion = expect(pendingSearch).rejects.toMatchObject({ code: "network_error" });
    await vi.advanceTimersByTimeAsync(35_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("keeps the timeout active while reading a stalled response body", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        json: () => new Promise<unknown>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      } as Response);
    });

    const pendingSearch = requestNearbyCandidates({ latitude: 52.52, longitude: 13.405, accuracyMeters: 12 }, fetcher);
    const assertion = expect(pendingSearch).rejects.toMatchObject({ code: "network_error" });
    await vi.advanceTimersByTimeAsync(35_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
