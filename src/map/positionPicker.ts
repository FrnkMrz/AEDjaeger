export interface Coordinate {
  latitude: number;
  longitude: number;
}

type PixelPoint = { x: number; y: number };
type PickerOptions = {
  mapLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  tileErrorLabel: string;
  onPositionChange: (position: Coordinate) => void;
};

const TILE_SIZE = 256;
const MIN_ZOOM = 15;
const MAX_ZOOM = 19;
const MAX_MERCATOR_LATITUDE = 85.05112878;

/** Converts a map coordinate to global pixels in the Web Mercator tile grid. */
export function projectCoordinate(position: Coordinate, zoom: number): PixelPoint {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, position.latitude));
  const radians = latitude * Math.PI / 180;
  return {
    x: (position.longitude + 180) / 360 * worldSize,
    y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * worldSize,
  };
}

/** Converts the pixel under the fixed marker back to the coordinate the mapper selected. */
export function unprojectPixel(point: PixelPoint, zoom: number): Coordinate {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const wrappedX = ((point.x % worldSize) + worldSize) % worldSize;
  const boundedY = Math.max(0, Math.min(worldSize, point.y));
  const n = Math.PI - 2 * Math.PI * boundedY / worldSize;
  return {
    latitude: 180 / Math.PI * Math.atan(Math.sinh(n)),
    longitude: wrappedX / worldSize * 360 - 180,
  };
}

export function moveMapCenter(position: Coordinate, dragX: number, dragY: number, zoom: number): Coordinate {
  const projected = projectCoordinate(position, zoom);
  return unprojectPixel({ x: projected.x - dragX, y: projected.y - dragY }, zoom);
}

/**
 * A small pan-only picker keeps the selected point fixed under the crosshair.
 * It loads only tiles intersecting the visible viewport from the standard OSM tile service.
 */
export function createPositionPicker(
  container: HTMLElement,
  initialPosition: Coordinate,
  options: PickerOptions,
): { destroy(): void } {
  let center = { ...initialPosition };
  let zoom = MAX_ZOOM;
  let pointer: { id: number; x: number; y: number; moved: boolean } | undefined;
  const tileLayer = document.createElement("div");
  tileLayer.className = "position-map-tiles";
  const status = document.createElement("span");
  status.className = "position-map-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const controls = document.createElement("div");
  controls.className = "position-map-controls";
  controls.innerHTML = `<button type="button" aria-label="${escapeAttribute(options.zoomInLabel)}" data-map-zoom="1">+</button><button type="button" aria-label="${escapeAttribute(options.zoomOutLabel)}" data-map-zoom="-1">−</button>`;
  const crosshair = document.createElement("span");
  crosshair.className = "position-map-crosshair";
  crosshair.setAttribute("aria-hidden", "true");
  const attribution = document.createElement("a");
  attribution.className = "position-map-attribution";
  attribution.href = "https://www.openstreetmap.org/copyright";
  attribution.target = "_blank";
  attribution.rel = "noopener noreferrer";
  attribution.textContent = "© OpenStreetMap contributors";
  attribution.setAttribute("aria-label", "© OpenStreetMap contributors");

  container.replaceChildren(tileLayer, crosshair, controls, attribution, status);
  container.setAttribute("aria-label", options.mapLabel);

  function renderTiles(): void {
    tileLayer.style.transform = "";
    const bounds = container.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const centerPixel = projectCoordinate(center, zoom);
    const left = centerPixel.x - width / 2;
    const top = centerPixel.y - height / 2;
    const firstX = Math.floor(left / TILE_SIZE);
    const lastX = Math.floor((left + width) / TILE_SIZE);
    const firstY = Math.max(0, Math.floor(top / TILE_SIZE));
    const lastY = Math.min(2 ** zoom - 1, Math.floor((top + height) / TILE_SIZE));
    const images: HTMLImageElement[] = [];

    for (let tileY = firstY; tileY <= lastY; tileY += 1) {
      for (let tileX = firstX; tileX <= lastX; tileX += 1) {
        const wrappedTileX = ((tileX % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
        const image = document.createElement("img");
        image.alt = "";
        image.draggable = false;
        image.width = TILE_SIZE;
        image.height = TILE_SIZE;
        image.style.left = `${tileX * TILE_SIZE - left}px`;
        image.style.top = `${tileY * TILE_SIZE - top}px`;
        image.src = `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`;
        image.addEventListener("error", () => {
          status.textContent = options.tileErrorLabel;
          status.hidden = false;
        }, { once: true });
        images.push(image);
      }
    }
    tileLayer.replaceChildren(...images);
    status.hidden = true;
  }

  function stopDragging(event: PointerEvent): void {
    if (!pointer || pointer.id !== event.pointerId) return;
    const { id, x, y, moved } = pointer;
    pointer = undefined;
    if (container.hasPointerCapture(id)) container.releasePointerCapture(id);
    if (moved) {
      center = moveMapCenter(center, event.clientX - x, event.clientY - y, zoom);
      options.onPositionChange(center);
      renderTiles();
    }
    container.classList.remove("is-dragging");
  }

  function onPointerDown(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest(".position-map-controls, .position-map-attribution")) return;
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    container.setPointerCapture(event.pointerId);
    container.classList.add("is-dragging");
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dragX = event.clientX - pointer.x;
    const dragY = event.clientY - pointer.y;
    if (Math.abs(dragX) + Math.abs(dragY) > 3) pointer.moved = true;
    if (pointer.moved) tileLayer.style.transform = `translate(${dragX}px, ${dragY}px)`;
  }

  function onKeyDown(event: KeyboardEvent): void {
    const shifts: Record<string, [number, number]> = {
      ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32],
    };
    const shift = shifts[event.key];
    if (shift) {
      event.preventDefault();
      center = moveMapCenter(center, shift[0], shift[1], zoom);
      options.onPositionChange(center);
      renderTiles();
    }
  }

  function onZoom(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-map-zoom]");
    if (!button) return;
    const change = Number(button.dataset.mapZoom);
    if (!Number.isInteger(change)) return;
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + change));
    renderTiles();
  }

  function onResize(): void { renderTiles(); }
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(container);
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", stopDragging);
  container.addEventListener("pointercancel", stopDragging);
  container.addEventListener("lostpointercapture", stopDragging);
  container.addEventListener("keydown", onKeyDown);
  controls.addEventListener("click", onZoom);
  renderTiles();

  return {
    destroy() {
      resizeObserver.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", stopDragging);
      container.removeEventListener("pointercancel", stopDragging);
      container.removeEventListener("lostpointercapture", stopDragging);
      container.removeEventListener("keydown", onKeyDown);
      controls.removeEventListener("click", onZoom);
      container.replaceChildren();
    },
  };
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
