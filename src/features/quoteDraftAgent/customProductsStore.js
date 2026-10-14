/**
 * Reviewer-added catalog products ("Add product" in Find in Catalog). Saved locally (collection
 * "autoDrafterCustomProducts", registered in electron/repository.cjs) and merged into
 * PRODUCT_CATALOG so every later draft can match and price them.
 */
import {retryBridgeCall} from "@/features/supervisorDashboard/retryBridgeCall";
import {PRODUCT_CATALOG, setRuntimeCustomProducts} from "./productCatalog";
import {normalizeForLookup} from "./learnedCorrections";

const COLLECTION = "autoDrafterCustomProducts";
const BROWSER_STORAGE_KEY = "enquote_autodrafter_custom_products_v1";

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

// A main process that predates this collection rejects it until the app is fully restarted;
// keep products in browser storage meanwhile and move them into the collection afterwards.
const isUnsupportedCollection = (error) => /Unsupported local collection/i.test(error?.message || "");

function readBrowserStorage() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(BROWSER_STORAGE_KEY);
    const records = raw ? JSON.parse(raw) : [];
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeBrowserStorage(records) {
  if (records.length) globalThis.window?.localStorage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(records));
  else globalThis.window?.localStorage?.removeItem(BROWSER_STORAGE_KEY);
}

export function customProductId(name) {
  return `product:${normalizeForLookup(name)}`;
}

async function upsert(bridge, record, existing) {
  return existing
    ? retryBridgeCall(`collections:update (${COLLECTION})`, () => bridge.update(COLLECTION, record.id, record))
    : retryBridgeCall(`collections:create (${COLLECTION})`, () => bridge.create(COLLECTION, record));
}

async function listAll() {
  const bridge = localBridge();
  if (!bridge) return readBrowserStorage();
  try {
    const records = await retryBridgeCall(`collections:list (${COLLECTION})`, () => bridge.list(COLLECTION));
    const pending = readBrowserStorage();
    if (!pending.length) return records;
    const byId = new Map(records.map((record) => [record.id, record]));
    for (const record of pending) {
      await upsert(bridge, record, byId.get(record.id));
      byId.set(record.id, record);
    }
    writeBrowserStorage([]);
    return [...byId.values()];
  } catch (error) {
    if (!isUnsupportedCollection(error)) throw error;
    return readBrowserStorage();
  }
}

export async function listCustomProducts() {
  return (await listAll()).filter((record) => !record.is_deleted);
}

// Loads saved products into the catalog; a failure leaves drafting on the built-in catalog only.
export async function loadCustomProducts() {
  try {
    const records = await listCustomProducts();
    setRuntimeCustomProducts(records);
    return records;
  } catch (error) {
    console.error("Failed to load custom catalog products:", error);
    return [];
  }
}

export function validateCustomProduct({name, unit_price: unitPrice, category}) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "Enter a product name.";
  if (!(Number(unitPrice) > 0)) return "Enter a unit price greater than $0.";
  if (!category) return "Choose a category.";
  if (PRODUCT_CATALOG.some((item) => !item.custom && item.name.toLowerCase() === trimmed.toLowerCase())) {
    return "That name is already in the catalog. Search for it instead.";
  }
  return "";
}

export async function saveCustomProduct({name, sku, category, unit_price: unitPrice, unit, addedBy, caseNumber, reference}) {
  const problem = validateCustomProduct({name, unit_price: unitPrice, category});
  if (problem) throw new Error(problem);
  const record = {
    id: customProductId(name), name: String(name).trim(), sku: String(sku || "").trim(), category,
    unit_price: Math.round(Number(unitPrice) * 100) / 100, unit: unit || "each",
    addedBy: addedBy || "", caseNumber: caseNumber ? String(caseNumber) : "", reference: reference || "",
    addedAt: new Date().toISOString(), is_deleted: false
  };
  const bridge = localBridge();
  const fallback = () => writeBrowserStorage([...readBrowserStorage().filter((item) => item.id !== record.id), record]);
  if (!bridge) fallback();
  else {
    try {
      const existing = (await listAll()).find((item) => item.id === record.id);
      await upsert(bridge, record, existing);
    } catch (error) {
      if (!isUnsupportedCollection(error)) throw error;
      fallback();
    }
  }
  await loadCustomProducts();
  return PRODUCT_CATALOG.find((item) => item.custom && item.name === record.name) || record;
}

export async function removeCustomProduct(name) {
  const id = customProductId(name);
  const bridge = localBridge();
  writeBrowserStorage(readBrowserStorage().filter((item) => item.id !== id));
  if (bridge) {
    try {
      await retryBridgeCall(`collections:delete (${COLLECTION})`, () => bridge.delete(COLLECTION, id));
    } catch (error) {
      if (!isUnsupportedCollection(error)) throw error;
    }
  }
  await loadCustomProducts();
}
