import { describe, expect, it, vi } from "vitest";
import { CandidateSearchError, requestNearbyCandidates } from "../src/osm/candidateSearch";

const location = { latitude: 52.52, longitude: 13.405, accuracyMeters: 12 };
const candidate = { id: "node/123", osmType: "node", coordinateQuality: "exact", position: { latitude: 52.52, longitude: 13.405 }, tags: { name: "Bahnhof" } };

describe("nearby candidate client", () => {
  it("does not send coordinates when GPS accuracy exceeds the usable threshold", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(requestNearbyCandidates({ ...location, accuracyMeters: 150 }, fetcher))
      .rejects.toMatchObject({ code: "location_too_uncertain" } satisfies Partial<CandidateSearchError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts versioned feed metadata with a complete candidate result", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      status: "complete", coverage_radius_meters: 112, snapshot_id: "aed-0123456789abcdef0123",
      data_until: "2026-11-08T12:00:00Z", candidates: [candidate],
    }, { headers: { "Retry-After": "12" } }));
    await expect(requestNearbyCandidates(location, fetcher)).resolves.toMatchObject({
      status: "complete", snapshotId: "aed-0123456789abcdef0123", dataUntil: "2026-11-08T12:00:00Z",
      candidates: [{ id: "node/123", tags: { name: "Bahnhof" } }], retryAfterSeconds: 12,
    });
    expect(fetcher.mock.calls[0][0]).toBe("/api/osm/candidates/search");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ latitude: 52.52, longitude: 13.405, accuracy_meters: 12 });
  });

  it("preserves Retry-After for throttling and unavailable feed responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "search_rate_limited" }, { status: 429, headers: { "Retry-After": "17" } }));
    await expect(requestNearbyCandidates(location, fetcher)).rejects.toMatchObject({ code: "search_rate_limited", retryAfterSeconds: 17 });
    fetcher.mockResolvedValue(Response.json({ error: "source_unavailable" }, { status: 502, headers: { "Retry-After": "23" } }));
    await expect(requestNearbyCandidates(location, fetcher)).rejects.toMatchObject({ code: "source_unavailable", retryAfterSeconds: 23 });
  });

  it("keeps the source of a candidate (archive or development) and accepts older answers without it", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValue(Response.json({ status: "complete", coverage_radius_meters: 112, candidates: [{ ...candidate, source: "archive" }, { ...candidate, id: "node/124", source: "development" }, { ...candidate, id: "node/125" }] }));
    const result = await requestNearbyCandidates(location, fetcher);
    expect(result.candidates.map((item) => item.source)).toEqual(["archive", "development", undefined]);
  });

  it("rejects an unknown candidate source", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "complete", coverage_radius_meters: 112, candidates: [{ ...candidate, source: "elsewhere" }] }));
    await expect(requestNearbyCandidates(location, fetcher)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects incomplete feed metadata and malformed candidate records", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "complete", coverage_radius_meters: 112, snapshot_id: "aed-bad", data_until: "yesterday", candidates: [candidate] }));
    await expect(requestNearbyCandidates(location, fetcher)).rejects.toMatchObject({ code: "invalid_response" });
    fetcher.mockResolvedValue(Response.json({ status: "complete", coverage_radius_meters: 112, candidates: [{ ...candidate, tags: { emergency: { invalid: true } } }] }));
    await expect(requestNearbyCandidates(location, fetcher)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("aborts a stalled request so the photo flow can offer a retry", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const pending = requestNearbyCandidates(location, fetcher);
    const assertion = expect(pending).rejects.toMatchObject({ code: "network_error" });
    await vi.advanceTimersByTimeAsync(35_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
