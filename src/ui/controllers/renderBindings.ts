import type { Language } from "../../i18n/translations";

type RenderBindingsContext = {
  hasUnresolvedSave(): boolean;
  focusCurrentState(): void;
  openAccountFromLamp(): void;
  onSoundToggle(enabled: boolean): void;
  onLanguageChange(language: Language): void;
  onPhotoSelected(event: Event): void;
  onAction(action: string | undefined, source: HTMLElement): void;
  bindAccountPanel(): void;
  renderUpdateBanner(): void;
  restoreFlowFocus: boolean;
};

/** Bind controls after a full app render so each fresh node receives exactly one listener. */
export function bindRenderedControls(app: HTMLElement, context: RenderBindingsContext): void {
  const correctionConfirmation = app.querySelector<HTMLInputElement>("#correction-confirmed");
  correctionConfirmation?.addEventListener("change", () => {
    const saveButton = app.querySelector<HTMLButtonElement>('[data-action="save-development-check"]');
    if (saveButton) saveButton.disabled = !correctionConfirmation.checked;
  });

  const absenceConfirmation = app.querySelector<HTMLInputElement>("#new-aed-absence-confirmed");
  absenceConfirmation?.addEventListener("change", () => {
    const createButton = app.querySelector<HTMLButtonElement>('[data-action="create-development-node"]');
    if (createButton) createButton.disabled = !absenceConfirmation.checked;
  });

  app.querySelector<HTMLButtonElement>("#open-info")?.addEventListener("click", () => {
    app.querySelector<HTMLDialogElement>("#info-dialog")?.showModal();
  });
  app.querySelector<HTMLButtonElement>("#connection-lamp")?.addEventListener("click", context.openAccountFromLamp);
  app.querySelector<HTMLInputElement>("#success-sound-toggle")?.addEventListener("change", (event) => {
    context.onSoundToggle((event.target as HTMLInputElement).checked);
  });
  app.querySelector<HTMLAnchorElement>(".brand")?.addEventListener("click", (event) => {
    if (!context.hasUnresolvedSave()) return;

    // Reloading here would erase the only copy of an unresolved draft in this in-memory prototype.
    event.preventDefault();
    context.focusCurrentState();
  });
  app.querySelector<HTMLSelectElement>("#language")?.addEventListener("change", (event) => {
    context.onLanguageChange((event.currentTarget as HTMLSelectElement).value as Language);
    // Rendering replaces the select node, so return focus to its translated replacement.
    app.querySelector<HTMLSelectElement>("#language")?.focus();
  });
  app.querySelector<HTMLInputElement>("#camera-input")?.addEventListener("change", context.onPhotoSelected);
  app.querySelector<HTMLInputElement>("#file-input")?.addEventListener("change", context.onPhotoSelected);
  app.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => context.onAction(button.dataset.action, button));
  });

  context.bindAccountPanel();
  context.renderUpdateBanner();
  if (context.restoreFlowFocus) context.focusCurrentState();
}
