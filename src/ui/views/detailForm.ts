import { DETAIL_LIMITS, type AedDetailForm, type DetailKey, type DetailTags } from "../../contracts/aedDetails";
import type { FlowMessageKey } from "../../i18n/flowTranslations";
import type { TranslationKey } from "../../i18n/translations";

type Translate = (key: TranslationKey, values?: Record<string, number | string>) => string;
type TranslateFlow = (key: FlowMessageKey, values?: Record<string, number | string>) => string;
type DetailTextField = "location" | "hoursText" | "operator" | "phone" | "description" | "ref";

export type DetailFormViewContext = {
  t: Translate;
  tv: TranslateFlow;
  escapeHtml: (value: string) => string;
  form: AedDetailForm;
  existingTags: DetailTags | undefined;
  correctMode: boolean;
  lockedKeys: ReadonlySet<DetailKey>;
  moreOpen: boolean;
};

export function detailHas(context: DetailFormViewContext, key: DetailKey): boolean {
  return context.existingTags !== undefined && Object.prototype.hasOwnProperty.call(context.existingTags, key);
}

function detailLocked(context: DetailFormViewContext, key: DetailKey): boolean {
  if (context.existingTags === undefined) return false;
  return context.correctMode ? context.lockedKeys.has(key) : detailHas(context, key);
}

export function existingValueLabel(context: DetailFormViewContext, key: DetailKey, value: string): string {
  const { tv } = context;
  if (key === "access")
    return (
      (
        {
          yes: tv("detailAccessYes"),
          customers: tv("detailAccessCustomers"),
          private: tv("detailAccessPrivate"),
        } as Record<string, string>
      )[value] ?? value
    );
  if (key === "indoor")
    return ({ yes: tv("detailIndoorYes"), no: tv("detailIndoorNo") } as Record<string, string>)[value] ?? value;
  if (key === "opening_hours" && value === "24/7") return tv("detailHoursAlways");
  return value;
}

export function detailMoreCountText(context: DetailFormViewContext): string {
  const set = [context.form.operator, context.form.phone, context.form.description, context.form.ref].filter(
    (text) => text.trim() !== "",
  ).length;
  return set === 0 ? context.tv("detailMoreOptional") : context.tv("detailMoreCount", { count: set });
}

export function detailContinueLabel(count: number, tv: TranslateFlow): string {
  if (count === 0) return tv("detailContinueNone");
  return count === 1 ? tv("detailContinueOne") : tv("detailContinueMany", { count });
}

function detailRadio(
  context: DetailFormViewContext,
  field: "access" | "hoursMode" | "indoor",
  value: string,
  label: string,
  checked: boolean,
  isUnknown = false,
): string {
  const id = `detail-${field}-${value === "" ? "unknown" : value}`;
  return `<span class="chip-wrap"><input class="chip-input" type="radio" name="detail-${field}" id="${id}" value="${context.escapeHtml(value)}" data-detail-radio="${field}"${checked ? " checked" : ""} /><label class="chip${isUnknown ? " chip-unknown" : ""}" for="${id}">${context.escapeHtml(label)}</label></span>`;
}

function detailTextInput(
  context: DetailFormViewContext,
  field: DetailTextField,
  id: string,
  maxLength: number,
  extraAttributes = "",
): string {
  return `<input class="field" id="${id}" type="text" maxlength="${maxLength}" value="${context.escapeHtml(context.form[field])}" data-detail-text="${field}" autocomplete="off" ${extraAttributes} />`;
}

function detailGroup(context: DetailFormViewContext, id: string, title: string, hint: string, body: string): string {
  // Die Gruppenüberschrift liegt im Kasten; aria-labelledby gibt der Gruppe denselben Namen für Screenreader.
  const { escapeHtml, tv } = context;
  return `<div class="detail-group" id="detail-group-${id}" role="group" aria-labelledby="detail-legend-${id}"><p class="detail-legend" id="detail-legend-${id}">${escapeHtml(title)}</p>${hint ? `<p class="detail-hint">${escapeHtml(hint)}</p>` : ""}${body}<p class="detail-was" data-detail-was="${id}" hidden></p><p class="detail-error" role="alert" data-detail-error="${id}" hidden>${tv("detailInvalid")}</p></div>`;
}

function detailLockedLine(context: DetailFormViewContext, key: DetailKey): string {
  const value = context.existingTags?.[key] ?? "";
  const note = context.correctMode ? `<p class="detail-hint">${context.tv("detailNotEditable")}</p>` : "";
  return `<p class="detail-locked">${context.escapeHtml(context.tv("detailExistingValue", { value: existingValueLabel(context, key, value) }))}</p>${note}`;
}

/** Reines Markup des Formulars; Fachvalidierung und OSM-Tagbildung bleiben im Domain-Vertrag. */
export function renderDetailForm(context: DetailFormViewContext): string {
  const { form: f, tv } = context;
  const unknown = tv("detailUnknown");
  const hasValue = (key: DetailKey): boolean => context.correctMode && detailHas(context, key);

  const quickWords = [
    tv("detailLocEntrance"),
    tv("detailLocFoyer"),
    tv("detailLocOutside"),
    tv("detailLocReception"),
    tv("detailLocStairs"),
  ];
  const location = detailGroup(
    context,
    "location",
    tv("detailLocationLabel"),
    detailLocked(context, "defibrillator:location") ? "" : tv("detailLocationHint"),
    detailLocked(context, "defibrillator:location")
      ? detailLockedLine(context, "defibrillator:location")
      : `<input class="field" id="detail-location" type="text" maxlength="${DETAIL_LIMITS.location}" value="${context.escapeHtml(f.location)}" data-detail-text="location" autocomplete="off" placeholder="${context.escapeHtml(tv("detailLocationPlaceholder"))}" aria-label="${context.escapeHtml(tv("detailLocationLabel"))}" /><div class="chip-row">${quickWords.map((word) => `<button type="button" class="chip chip-small" data-detail-addloc="${context.escapeHtml(word)}">${context.escapeHtml(word)}</button>`).join("")}</div>`,
  );

  const access = detailGroup(
    context,
    "access",
    tv("detailAccessLabel"),
    detailLocked(context, "access") ? "" : tv("detailAccessHint"),
    detailLocked(context, "access")
      ? detailLockedLine(context, "access")
      : `<div class="chip-row">${detailRadio(context, "access", "yes", tv("detailAccessYes"), f.access === "yes")}${detailRadio(context, "access", "customers", tv("detailAccessCustomers"), f.access === "customers")}${detailRadio(context, "access", "private", tv("detailAccessPrivate"), f.access === "private")}${hasValue("access") ? "" : detailRadio(context, "access", "", unknown, f.access === null, true)}</div>`,
  );

  const timesField =
    f.hoursMode === "times"
      ? `<div class="detail-sub"><label class="detail-hint" for="detail-hours-text">${tv("detailHoursTextLabel")}</label>${detailTextInput(context, "hoursText", "detail-hours-text", DETAIL_LIMITS.openingHours, 'placeholder="Mo-Fr 08:00-18:00" autocapitalize="off" spellcheck="false"')}<div class="chip-row"><button type="button" class="chip chip-small" data-detail-hours-preset="Mo-Fr 08:00-18:00">Mo-Fr 08:00-18:00</button><button type="button" class="chip chip-small" data-detail-hours-preset="Mo-Sa 07:00-20:00">Mo-Sa 07:00-20:00</button></div></div>`
      : "";
  const hours = detailGroup(
    context,
    "hours",
    tv("detailHoursLabel"),
    detailLocked(context, "opening_hours") ? "" : tv("detailHoursHint"),
    detailLocked(context, "opening_hours")
      ? detailLockedLine(context, "opening_hours")
      : `<div class="chip-row">${detailRadio(context, "hoursMode", "always", tv("detailHoursAlways"), f.hoursMode === "always")}${detailRadio(context, "hoursMode", "times", tv("detailHoursTimes"), f.hoursMode === "times")}${hasValue("opening_hours") ? "" : detailRadio(context, "hoursMode", "", unknown, f.hoursMode === null, true)}</div>${timesField}`,
  );

  const effectiveIndoor = detailLocked(context, "indoor") ? context.existingTags?.indoor : f.indoor;
  const levelField =
    effectiveIndoor === "yes"
      ? detailLocked(context, "level")
        ? detailLockedLine(context, "level")
        : `<div class="detail-sub"><span class="detail-hint" id="detail-level-label">${tv("detailLevelLabel")}</span><div class="stepper" role="group" aria-labelledby="detail-level-label"><button type="button" class="step-button" id="detail-level-down" data-detail-step="-1" aria-label="${context.escapeHtml(tv("detailLevelLower"))}">−</button><output class="step-value" id="detail-level-value" aria-live="polite">${f.level === null ? "–" : f.level}</output><button type="button" class="step-button" id="detail-level-up" data-detail-step="1" aria-label="${context.escapeHtml(tv("detailLevelHigher"))}">+</button>${hasValue("level") ? "" : `<button type="button" class="chip chip-small chip-unknown" id="detail-level-clear" data-detail-level-clear="1">${unknown}</button>`}</div></div>`
      : "";
  const indoor = detailGroup(
    context,
    "indoor",
    tv("detailIndoorLabel"),
    "",
    (detailLocked(context, "indoor")
      ? detailLockedLine(context, "indoor")
      : `<div class="chip-row">${detailRadio(context, "indoor", "yes", tv("detailIndoorYes"), f.indoor === "yes")}${detailRadio(context, "indoor", "no", tv("detailIndoorNo"), f.indoor === "no")}${hasValue("indoor") ? "" : detailRadio(context, "indoor", "", unknown, f.indoor === null, true)}</div>`) +
      levelField,
  );

  const moreField = (
    key: "operator" | "phone" | "description" | "ref",
    label: string,
    maxLength: number,
    extra = "",
    note = "",
  ): string =>
    detailLocked(context, key)
      ? `<div><span class="detail-hint">${label}</span>${detailLockedLine(context, key)}</div>`
      : `<div><label class="detail-hint" for="detail-${key}">${label}</label>${detailTextInput(context, key, `detail-${key}`, maxLength, extra)}${note}</div>`;
  const more =
    `<details class="detail-more" id="detail-more"${context.moreOpen ? " open" : ""}><summary><span>${tv("detailMoreTitle")}</span><span class="detail-more-count" id="detail-more-count">${detailMoreCountText(context)}</span></summary><div class="detail-more-body">` +
    moreField("operator", tv("detailOperatorLabel"), DETAIL_LIMITS.operator) +
    moreField(
      "phone",
      tv("detailPhoneLabel"),
      DETAIL_LIMITS.phone,
      'inputmode="tel" autocomplete="off"',
      `<p class="detail-hint">${tv("detailPhoneHint")}</p>`,
    ) +
    moreField("description", tv("detailDescriptionLabel"), DETAIL_LIMITS.description) +
    moreField("ref", tv("detailRefLabel"), DETAIL_LIMITS.ref) +
    `<p class="detail-hint">${tv("detailNoCode")}</p><p class="detail-was" data-detail-was="more" hidden></p><p class="detail-error" role="alert" data-detail-error="more" hidden>${tv("detailInvalid")}</p></div></details>`;

  return `${location}${access}${hours}${indoor}${more}`;
}
