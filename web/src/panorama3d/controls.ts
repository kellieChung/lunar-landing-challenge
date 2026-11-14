// First-person look controls: drag to look around, wheel or pinch to zoom.
// Grab-and-drag like the 2D strip: the scene follows the pointer.

export interface LookTarget {
  /** Field of view in degrees across the canvas: horizontal and vertical. */
  fovDeg(): { h: number; v: number };
  look(dYawDeg: number, dPitchDeg: number): void;
  zoom(factor: number): void; // > 1 widens the view
}

export function attachLookControls(canvas: HTMLCanvasElement, target: LookTarget): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;

  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', (ev) => {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('dragging');
    if (pointers.size === 2) pinchDist = spread();
  });

  canvas.addEventListener('pointermove', (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    pointers.set(ev.pointerId, cur);
    if (pointers.size === 1) {
      const { h, v } = target.fovDeg();
      const w = canvas.clientWidth || 1;
      const hh = canvas.clientHeight || 1;
      target.look(-(cur.x - prev.x) * (h / w), (cur.y - prev.y) * (v / hh));
    } else if (pointers.size === 2) {
      const d = spread();
      if (pinchDist > 0 && d > 0) target.zoom(pinchDist / d);
      pinchDist = d;
    }
  });

  const end = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId);
    if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    if (pointers.size === 0) canvas.classList.remove('dragging');
    pinchDist = pointers.size === 2 ? spread() : 0;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    target.zoom(Math.exp(ev.deltaY * 0.0015));
  }, { passive: false });
}
