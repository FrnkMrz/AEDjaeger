import type { FlowMessageKey } from "../../i18n/flowTranslations";

type TranslateFlow = (key: FlowMessageKey, values?: Record<string, number | string>) => string;

type UpdateBannerContext = {
  app: HTMLElement;
  isUpdateAvailable(): boolean;
  reloadBlocked(): boolean;
  hasActivePhotoDraft(): boolean;
  translate: TranslateFlow;
  reload(): void;
};

/** Hält das Rendern des Update-Hinweises und seinen fokuswahrenden Zustand zusammen. */
export function createUpdateBannerRenderer(context: UpdateBannerContext): () => void {
  let renderedMarkup = "";

  return () => {
    let banner = document.querySelector<HTMLElement>("#update-banner");
    if (!context.isUpdateAvailable()) {
      banner?.remove();
      renderedMarkup = "";
      return;
    }
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "update-banner";
      banner.className = "update-banner";
      banner.setAttribute("role", "status");
      banner.addEventListener("click", (event) => {
        // Beim Tippen erneut prüfen: Seit dem Zeichnen kann ein Speichervorgang begonnen haben.
        if ((event.target as HTMLElement).closest(".update-banner-button") && !context.reloadBlocked()) {
          context.reload();
        }
      });
      context.app.before(banner);
      renderedMarkup = "";
    }

    const blocked = context.reloadBlocked();
    const note = blocked
      ? context.translate("updateWaitSave")
      : context.hasActivePhotoDraft()
        ? context.translate("updateLosesPhoto")
        : "";
    const markup = `<span>${context.translate("updateAvailable")}${note ? ` ${note}` : ""}</span><button class="update-banner-button" type="button" ${blocked ? "disabled" : ""}>${context.translate("updateReload")}</button>`;
    // Unverändertes Markup nicht neu schreiben, damit der Tastaturfokus auf dem Knopf bleibt.
    if (markup !== renderedMarkup) {
      banner.innerHTML = markup;
      renderedMarkup = markup;
    }
  };
}
