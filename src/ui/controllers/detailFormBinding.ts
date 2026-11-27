import { ACCESS_VALUES, type AedDetailForm, DETAIL_LIMITS, INDOOR_VALUES } from "../../contracts/aedDetails";

type DetailTextField = "location" | "hoursText" | "operator" | "phone" | "description" | "ref";

const DETAIL_TEXT_FIELDS: readonly DetailTextField[] = [
  "location",
  "hoursText",
  "operator",
  "phone",
  "description",
  "ref",
];

type DetailFormBindingContext = {
  getForm: () => AedDetailForm;
  refreshDetailForm: (focusId?: string) => void;
  showDetailLevel: () => void;
  updateDetailFooter: () => void;
  setMoreOpen: (open: boolean) => void;
};

function isDetailTextField(value: string | undefined): value is DetailTextField {
  return value !== undefined && (DETAIL_TEXT_FIELDS as readonly string[]).includes(value);
}

function pickAllowed<T extends string>(allowed: readonly T[], raw: string): T | null {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Bind the detail form's input behavior to its persistent outer container. */
export function bindDetailForm(root: ParentNode, context: DetailFormBindingContext): void {
  const host = root.querySelector<HTMLElement>("#detail-form");
  if (!host) return;

  // Radio controls change which dependent fields appear, so redraw the inner form and restore focus.
  host.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "radio") return;
    const form = context.getForm();
    const field = target.dataset.detailRadio;
    if (field === "access") {
      form.access = pickAllowed(ACCESS_VALUES, target.value);
    } else if (field === "indoor") {
      form.indoor = pickAllowed(INDOOR_VALUES, target.value);
      // The level belongs only to a device inside a building.
      if (form.indoor !== "yes") form.level = null;
    } else if (field === "hoursMode") {
      form.hoursMode = pickAllowed(["always", "times"] as const, target.value);
    } else {
      return;
    }
    context.refreshDetailForm(target.id);
  });

  // Text edits update the model and footer only, keeping the focused input intact while the user types.
  host.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const field = target.dataset.detailText;
    if (!isDetailTextField(field)) return;
    context.getForm()[field] = target.value;
    context.updateDetailFooter();
  });

  // Quick location choices, opening-hours presets and the level stepper.
  host.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>("button");
    if (!button) return;
    const form = context.getForm();
    if (button.dataset.detailAddloc !== undefined) {
      const base = form.location.trim();
      const next = base === "" ? button.dataset.detailAddloc : `${base}, ${button.dataset.detailAddloc}`;
      if (next.length > DETAIL_LIMITS.location) return;
      form.location = next;
      const input = host.querySelector<HTMLInputElement>("#detail-location");
      if (input) input.value = next;
      context.updateDetailFooter();
    } else if (button.dataset.detailHoursPreset !== undefined) {
      form.hoursText = button.dataset.detailHoursPreset;
      const input = host.querySelector<HTMLInputElement>("#detail-hours-text");
      if (input) input.value = form.hoursText;
      context.updateDetailFooter();
    } else if (button.dataset.detailStep !== undefined) {
      const step = Number(button.dataset.detailStep) < 0 ? -1 : 1;
      // The first tap lands on 0 (ground floor), whichever direction was pressed.
      form.level =
        form.level === null ? 0 : Math.max(DETAIL_LIMITS.levelMin, Math.min(DETAIL_LIMITS.levelMax, form.level + step));
      context.showDetailLevel();
      context.updateDetailFooter();
    } else if (button.dataset.detailLevelClear !== undefined) {
      form.level = null;
      context.showDetailLevel();
      context.updateDetailFooter();
    }
  });

  // `toggle` does not bubble, so listen in the capture phase and restore the open state after redraws.
  host.addEventListener(
    "toggle",
    (event) => {
      if (event.target instanceof HTMLDetailsElement && event.target.id === "detail-more") {
        context.setMoreOpen(event.target.open);
      }
    },
    true,
  );

  // Reapply the button state and inline errors when returning from the preview.
  context.updateDetailFooter();
}
