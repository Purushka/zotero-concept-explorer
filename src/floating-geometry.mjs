// Host coordinates are CSS pixels, not desktop pixels. Never alter the archive.
export const EDGE_GAP = 12;
export const SNAP_DISTANCE = 24;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function readFloatingPosition(value) {
  try {
    const position = typeof value === 'string' ? JSON.parse(value) : value;
    if (!position || position.version !== 1 || !finite(position.x) || !finite(position.y) ||
        position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) return null;
    return {version:1, x:position.x, y:position.y};
  } catch { return null; }
}

export function floatingBounds({width, height, top = 0}, size, gap = EDGE_GAP) {
  const left = Math.min(gap, Math.max(0, width / 2));
  const upper = Math.min(Math.max(gap, top + gap), Math.max(0, height - gap));
  return {left, top:upper, right:Math.max(left, width - gap - size.width),
    bottom:Math.max(upper, height - gap - size.height)};
}

export function fitFloatingPosition(position, bounds, {snap = false, distance = SNAP_DISTANCE} = {}) {
  let left = clamp(position.left, bounds.left, bounds.right);
  let top = clamp(position.top, bounds.top, bounds.bottom);
  if (snap) {
    // Resolve the nearer edge independently on both axes, including corners.
    const x = Math.abs(left - bounds.left) <= Math.abs(left - bounds.right) ? bounds.left : bounds.right;
    const y = Math.abs(top - bounds.top) <= Math.abs(top - bounds.bottom) ? bounds.top : bounds.bottom;
    if (Math.abs(left - x) <= distance) left = x;
    if (Math.abs(top - y) <= distance) top = y;
  }
  return {left, top};
}

export function encodeFloatingPosition(position, bounds) {
  const fitted = fitFloatingPosition(position, bounds);
  return {version:1, x:bounds.right === bounds.left ? 0 : (fitted.left - bounds.left) / (bounds.right - bounds.left),
    y:bounds.bottom === bounds.top ? 0 : (fitted.top - bounds.top) / (bounds.bottom - bounds.top)};
}

export function restoreFloatingPosition(saved, bounds) {
  const position = readFloatingPosition(saved) ?? {x:1, y:1};
  return {left:bounds.left + position.x * (bounds.right - bounds.left),
    top:bounds.top + position.y * (bounds.bottom - bounds.top)};
}
