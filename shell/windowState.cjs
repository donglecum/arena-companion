// Main window placement across launches. Pure so it can be unit-tested: given
// what was saved and the current displays' work areas, decide where to open.
const DEFAULT_SIZE = { width: 1180, height: 820 };
const MIN_SIZE = { width: 480, height: 300 };

/**
 * `saved` is { x, y, width, height, maximized } (or anything unusable).
 * The position is kept only while enough of the title bar would be on some
 * display to grab it — an unplugged monitor must never strand the window.
 */
function restoreBounds(saved, workAreas) {
  const areas = Array.isArray(workAreas) ? workAreas.filter(Boolean) : [];
  const maximized = Boolean(saved?.maximized);
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) {
    return { ...DEFAULT_SIZE, maximized };
  }
  const maxWidth = Math.max(MIN_SIZE.width, ...areas.map((a) => a.width));
  const maxHeight = Math.max(MIN_SIZE.height, ...areas.map((a) => a.height));
  const width = Math.min(maxWidth, Math.max(MIN_SIZE.width, Math.round(saved.width)));
  const height = Math.min(maxHeight, Math.max(MIN_SIZE.height, Math.round(saved.height)));
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { width, height, maximized };
  const x = Math.round(saved.x);
  const y = Math.round(saved.y);
  const grabbable = areas.some((a) =>
    x + width - 100 > a.x && x + 100 < a.x + a.width && // 100px of title bar across
    y >= a.y - 8 && y + 30 <= a.y + a.height);           // title bar vertically inside
  return grabbable ? { x, y, width, height, maximized } : { width, height, maximized };
}

module.exports = { DEFAULT_SIZE, MIN_SIZE, restoreBounds };
