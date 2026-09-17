/**
 * Persisted tile order and visibility for the Executive Overview's unified,
 * customizable tile grid - follows the exact same local-storage pattern as
 * columnPreferences.js (per-machine/per-Windows-user, since AppData is
 * inherently scoped to the signed-in OS user account).
 *
 * Order is stored as ONE global list of tile ids covering every known tile
 * (not per report-filter) - filtering by report just shows/hides a subset of
 * this same order, so a tile's position is remembered consistently no matter
 * which report filter is active when you look at it.
 */
const STORAGE_KEY = "enquote_executive_overview_tile_prefs_v1";

function readPrefs() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    globalThis.window?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort only - the customization just won't persist this time.
  }
}

/** @returns {string[]} the saved global tile order (empty array if never set). */
export function getTileOrder() {
  const prefs = readPrefs();
  return Array.isArray(prefs.order) ? prefs.order : [];
}

/** Overwrites the saved global tile order; persists immediately. */
export function setTileOrder(order) {
  const prefs = readPrefs();
  prefs.order = order;
  writePrefs(prefs);
}

/** @returns {Set<string>} ids of tiles currently hidden by the user. */
export function getHiddenTileIds() {
  const prefs = readPrefs();
  return new Set(Array.isArray(prefs.hidden) ? prefs.hidden : []);
}

/** Shows or hides one tile by id; persists immediately. */
export function setTileVisibility(id, visible) {
  const prefs = readPrefs();
  const hidden = new Set(Array.isArray(prefs.hidden) ? prefs.hidden : []);
  if (visible) hidden.delete(id); else hidden.add(id);
  prefs.hidden = Array.from(hidden);
  writePrefs(prefs);
}

/**
 * Orders a (possibly filtered) list of tiles according to the saved global
 * order - any tile not yet in the saved order is appended at the end, in its
 * original registry order, so newly-added tile types always show up
 * somewhere sensible instead of silently disappearing.
 */
export function orderTiles(tiles, savedOrder) {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const ordered = [];
  savedOrder.forEach((id) => {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  });
  tiles.forEach((t) => {
    if (byId.has(t.id)) ordered.push(t);
  });
  return ordered;
}

/**
 * Merges a NEW order for a filtered/visible subset of tiles back into the
 * FULL global saved order - preserves the relative position of every
 * currently-hidden-by-filter tile, only reshuffling the ones the user
 * actually dragged. This is what makes reordering while a report filter is
 * active behave sensibly instead of losing track of other categories'
 * positions.
 */
export function applyPartialReorder(fullOrderIds, visibleIdsInNewOrder) {
  const visibleSet = new Set(visibleIdsInNewOrder);
  const rest = fullOrderIds.filter((id) => !visibleSet.has(id));
  const firstIndex = fullOrderIds.findIndex((id) => visibleSet.has(id));
  const insertAt = firstIndex === -1 ? rest.length : Math.min(firstIndex, rest.length);
  return [...rest.slice(0, insertAt), ...visibleIdsInNewOrder, ...rest.slice(insertAt)];
}