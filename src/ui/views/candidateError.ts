import type { FlowState } from "../../domain/workflow";
import type { StatusContentContext } from "./statusContent";

type CandidateErrorContext = Omit<StatusContentContext, "state"> & {
  state: Extract<FlowState, { kind: "candidate-error" }>;
};

/** Render search failure guidance while leaving retry timing to the workflow owner. */
export function renderCandidateError(context: CandidateErrorContext): string {
  const { state, tv, photoMarkup, searchLocationSource } = context;
  const errorKey = {
    "location-unavailable": "locationUnavailable",
    "location-denied": "locationDenied",
    "location-uncertain": "locationUncertain",
    "sign-in": "errorSignIn",
    "rate-limited": "searchRateLimited",
    "service-unavailable": "searchUnavailable",
    "outside-coverage": "outsideCoverage",
    failed: "searchFailed",
    "invalid-response": "errorInvalidResponse",
  } as const;
  const retryWaitSeconds =
    state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
  const retry =
    state.reason === "sign-in" || state.reason === "outside-coverage"
      ? ""
      : retryWaitSeconds > 0
        ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
        : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`;
  const locationSource =
    searchLocationSource === "photo"
      ? "locationSourcePhoto"
      : searchLocationSource === "map"
        ? "locationSourceMap"
        : "locationSourcePhone";
  return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("searchTitle")}</h2><p>${tv(errorKey[state.reason])}</p><p class="supporting-copy">${tv(locationSource)}</p></div></div>${retry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
}
