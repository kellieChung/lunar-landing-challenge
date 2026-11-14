export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectsOverlap(a: Rect, b: Rect, margin = 2): boolean {
  return !(
    a.right + margin < b.left ||
    a.left - margin > b.right ||
    a.bottom + margin < b.top ||
    a.top - margin > b.bottom
  );
}

export interface LabelCandidate<T> {
  item: T;
  rect: Rect;
  priority: number; // Higher number = higher priority (e.g. 2 for selected, 1 for hovered, 0 for normal)
}

/**
 * Filter label candidates to avoid overlapping labels on screen.
 * Priority candidates (priority > 0) are always shown. Non-priority candidates
 * are shown only if they do not collide with any already-accepted label.
 */
export function filterCollidingLabels<T>(candidates: LabelCandidate<T>[], margin = 2): T[] {
  // Sort descending by priority
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const accepted: LabelCandidate<T>[] = [];

  for (const c of sorted) {
    if (c.priority > 0) {
      accepted.push(c);
      continue;
    }
    const collides = accepted.some((acc) => rectsOverlap(c.rect, acc.rect, margin));
    if (!collides) {
      accepted.push(c);
    }
  }

  return accepted.map((a) => a.item);
}
