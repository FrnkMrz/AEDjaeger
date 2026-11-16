type AccountPanelBindingContext = {
  app: HTMLElement;
  renderPanel(): string;
  onSignOut(): void;
  onRetrySession(): void;
};

/** Bindet Kontoaktionen und ersetzt deren Markup außerhalb der zentralen App-Einstiegsdatei. */
export function createAccountPanelBindings(context: AccountPanelBindingContext): {
  bind(): void;
  update(focusSelector?: string): void;
} {
  function bind(): void {
    context.app.querySelector<HTMLButtonElement>("#osm-sign-out")?.addEventListener("click", context.onSignOut);
    context.app
      .querySelector<HTMLButtonElement>("#osm-session-retry")
      ?.addEventListener("click", context.onRetrySession);
  }

  function update(focusSelector?: string): void {
    const currentPanel = context.app.querySelector(".account-panel");
    if (!currentPanel) return;
    const replacement = document.createElement("div");
    replacement.innerHTML = context.renderPanel();
    const nextPanel = replacement.firstElementChild;
    if (!nextPanel) return;
    currentPanel.replaceWith(nextPanel);
    bind();

    if (!focusSelector) return;
    const focusTarget =
      nextPanel instanceof HTMLElement && nextPanel.matches(focusSelector)
        ? nextPanel
        : nextPanel.querySelector<HTMLElement>(focusSelector);
    if (focusTarget) focusTarget.focus();
    else if (nextPanel instanceof HTMLElement) nextPanel.focus();
  }

  return { bind, update };
}
