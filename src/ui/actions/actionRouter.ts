/** Each visible action is routed to the module that owns its workflow transitions. */
type ActionGroup = "photoLocation" | "candidate" | "newEntry" | "existingDetails" | "developmentWrite";

export type ActionDispatchResult = "unhandled" | "handled" | "stop";

export type ActionHandlers = Record<ActionGroup, () => ActionDispatchResult | Promise<ActionDispatchResult>>;

const actionGroupByName = {
  "confirm-sighting": "photoLocation",
  "check-photo": "photoLocation",
  "start-photo-override": "photoLocation",
  "confirm-photo-override": "photoLocation",
  "confirm-photo-date": "photoLocation",
  "use-phone-location": "photoLocation",
  "choose-map-location": "photoLocation",
  "confirm-map-location": "photoLocation",
  "retry-search": "photoLocation",
  "preview-candidate": "candidate",
  "none-of-these": "candidate",
  "start-new-entry": "candidate",
  "preview-new-aed": "newEntry",
  "details-continue": "newEntry",
  "back-from-details": "newEntry",
  "back-to-details": "newEntry",
  "back-to-search": "newEntry",
  "open-existing-details": "existingDetails",
  "open-candidate-details": "existingDetails",
  "existing-details-retry": "existingDetails",
  "existing-details-continue": "existingDetails",
  "back-from-existing-details": "existingDetails",
  "back-to-existing-details": "existingDetails",
  "continue-recovery": "developmentWrite",
  retake: "developmentWrite",
  "create-development-node": "developmentWrite",
  "back-to-candidates": "developmentWrite",
  "save-development-check": "developmentWrite",
  "retry-development-write": "developmentWrite",
} as const satisfies Record<string, ActionGroup>;

/**
 * Route by the action name declared in the view instead of probing every workflow handler.
 * Unknown actions remain unhandled so the controller can preserve its existing fallback render.
 */
export async function dispatchUiAction(
  action: string | undefined,
  handlers: ActionHandlers,
): Promise<ActionDispatchResult> {
  if (!action || !Object.hasOwn(actionGroupByName, action)) return "unhandled";
  return handlers[actionGroupByName[action as keyof typeof actionGroupByName]]();
}
