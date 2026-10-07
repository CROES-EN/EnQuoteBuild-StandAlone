import {getCurrentUserNamespace, scopedKey} from "@/lib/userScopedStorage";

// Sidebar tab order is a per-user list of page ids. Pages missing from the saved list
// (e.g. added in a later update) keep their default order after the saved ones.
const LEGACY_SIDEBAR_ORDER_KEY = "enquote_sidebar_order";
const SIDEBAR_ORDER_KEY = "enquote_sidebar_order_v2";

function parseOrder(raw) {
  try {
    const parsed = JSON.parse(raw || "null");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : null;
  } catch {
    return null;
  }
}

export function readSidebarOrder(storage = globalThis.localStorage) {
  try {
    const saved = parseOrder(storage.getItem(scopedKey(SIDEBAR_ORDER_KEY)));
    if (saved) return saved;
    // The old per-computer order is handed to the first signed-in user only, then removed so
    // nobody else on this PC inherits it.
    const legacy = parseOrder(storage.getItem(LEGACY_SIDEBAR_ORDER_KEY));
    if (!legacy || getCurrentUserNamespace() === "__anonymous__") return null;
    storage.setItem(scopedKey(SIDEBAR_ORDER_KEY), JSON.stringify(legacy));
    storage.removeItem(LEGACY_SIDEBAR_ORDER_KEY);
    return legacy;
  } catch {
    return null;
  }
}

export function writeSidebarOrder(order, storage = globalThis.localStorage) {
  try {
    if (order) storage.setItem(scopedKey(SIDEBAR_ORDER_KEY), JSON.stringify(order));
    else storage.removeItem(scopedKey(SIDEBAR_ORDER_KEY));
  } catch { /* ignore */ }
}

export function applySidebarOrder(items, order) {
  if (!order?.length) return items;
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (rank.get(a.item.page) ?? order.length + a.index) - (rank.get(b.item.page) ?? order.length + b.index))
    .map(({ item }) => item);
}
