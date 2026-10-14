/**
 * Reviewer-taught line-item swaps: "when a request says <phrase>, use <catalog item>".
 * Saved locally (collection "autoDrafterLearnedSwaps", registered in electron/repository.cjs)
 * and loaded into learnedCorrections.js so every later draft uses the swap automatically.
 */
import {retryBridgeCall} from "@/features/supervisorDashboard/retryBridgeCall";
import {normalizeForLookup, setRuntimeLearnedCorrections} from "./learnedCorrections";
import {loadCustomProducts} from "./customProductsStore";
import {
  categoryCaseId, categoryRuleId, isCategoryLearningRecord, MIN_RULE_PHRASE_LENGTH, setRuntimeCategoryLearning
} from "@/features/autoDrafter/categoryLearning";

const COLLECTION = "autoDrafterLearnedSwaps";
const BROWSER_STORAGE_KEY = "enquote_autodrafter_learned_swaps_v1";

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

function readBrowserStorage() {
  const raw = globalThis.window?.localStorage?.getItem(BROWSER_STORAGE_KEY);
  const records = raw ? JSON.parse(raw) : [];
  return Array.isArray(records) ? records : [];
}

function writeBrowserStorage(records) {
  globalThis.window?.localStorage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(records));
}

export function learnedSwapId(phrase) {
  return `swap:${normalizeForLookup(phrase)}`;
}

export async function listLearnedSwaps() {
  const bridge = localBridge();
  const records = bridge
    ? await retryBridgeCall(`collections:list (${COLLECTION})`, () => bridge.list(COLLECTION))
    : readBrowserStorage();
  return records.filter(record => !record.is_deleted);
}

// Loads saved swaps (and reviewer-added products they may point to) into the draft engine;
// a failure leaves drafting on the built-in lists only.
export async function loadLearnedSwaps() {
  await loadCustomProducts();
  try {
    const records = await listLearnedSwaps();
    setRuntimeLearnedCorrections(records.filter(record => !isCategoryLearningRecord(record)));
    setRuntimeCategoryLearning(records.filter(isCategoryLearningRecord));
    return records;
  } catch (error) {
    console.error("Failed to load learned line-item swaps:", error);
    return [];
  }
}

export async function saveLearnedSwap({phrase, catalogName, previousName, taughtBy, caseNumber}) {
  const key = normalizeForLookup(phrase);
  if (!key || !catalogName) throw new Error("A requested phrase and catalog item are required.");
  const record = {
    id: learnedSwapId(phrase), phrase: String(phrase).trim(), catalogName, previousName: previousName || "",
    taughtBy: taughtBy || "", caseNumber: caseNumber ? String(caseNumber) : "", taughtAt: new Date().toISOString(),
    is_deleted: false
  };
  const bridge = localBridge();
  if (bridge) {
    const existing = await retryBridgeCall(`collections:list (${COLLECTION})`, () => bridge.list(COLLECTION));
    await (existing.some(item => item.id === record.id)
      ? retryBridgeCall(`collections:update (${COLLECTION})`, () => bridge.update(COLLECTION, record.id, record))
      : retryBridgeCall(`collections:create (${COLLECTION})`, () => bridge.create(COLLECTION, record)));
  } else {
    writeBrowserStorage([...readBrowserStorage().filter(item => item.id !== record.id), record]);
  }
  await loadLearnedSwaps();
  return record;
}

export async function forgetLearnedSwap(phrase) {
  const id = learnedSwapId(phrase);
  const bridge = localBridge();
  if (bridge) {
    await retryBridgeCall(`collections:delete (${COLLECTION})`, () => bridge.delete(COLLECTION, id));
  } else {
    writeBrowserStorage(readBrowserStorage().filter(item => item.id !== id));
  }
  await loadLearnedSwaps();
}

async function upsertRecord(record) {
  const bridge = localBridge();
  if (bridge) {
    const existing = await retryBridgeCall(`collections:list (${COLLECTION})`, () => bridge.list(COLLECTION));
    await (existing.some(item => item.id === record.id)
      ? retryBridgeCall(`collections:update (${COLLECTION})`, () => bridge.update(COLLECTION, record.id, record))
      : retryBridgeCall(`collections:create (${COLLECTION})`, () => bridge.create(COLLECTION, record)));
  } else {
    writeBrowserStorage([...readBrowserStorage().filter(item => item.id !== record.id), record]);
  }
}

async function deleteRecord(id) {
  const bridge = localBridge();
  if (bridge) {
    const existing = await retryBridgeCall(`collections:list (${COLLECTION})`, () => bridge.list(COLLECTION));
    if (existing.some(item => item.id === id)) {
      await retryBridgeCall(`collections:delete (${COLLECTION})`, () => bridge.delete(COLLECTION, id));
    }
  } else {
    writeBrowserStorage(readBrowserStorage().filter(item => item.id !== id));
  }
}

// Saves a reviewer's category correction for one case and, optionally, a rule that teaches every
// later request: "requests mentioning <phrase> are <category>" or "<phrase> is a PV module".
export async function saveCategoryCorrection({caseNumber, category, automaticCategory, note, rule, taughtBy}) {
  const now = new Date().toISOString();
  const phrase = String(rule?.phrase || "").replace(/\s+/g, " ").trim();
  if (rule && phrase && phrase.length < MIN_RULE_PHRASE_LENGTH) {
    throw new Error(`A learned phrase needs at least ${MIN_RULE_PHRASE_LENGTH} characters.`);
  }
  if (caseNumber && category) {
    await upsertRecord({
      id: categoryCaseId(caseNumber), kind: "category_case", caseNumber: String(caseNumber), category,
      automaticCategory: automaticCategory || "", note: String(note || "").trim(), taughtBy: taughtBy || "",
      taughtAt: now, is_deleted: false
    });
  }
  if (rule && phrase) {
    await upsertRecord({
      id: categoryRuleId(phrase), kind: "category_rule", phrase, category: rule.category,
      caseNumber: caseNumber ? String(caseNumber) : "", taughtBy: taughtBy || "", taughtAt: now, is_deleted: false
    });
  }
  await loadLearnedSwaps();
}

export async function forgetCategoryCorrection(caseNumber) {
  await deleteRecord(categoryCaseId(caseNumber));
  await loadLearnedSwaps();
}

export async function forgetCategoryRule(phrase) {
  await deleteRecord(categoryRuleId(phrase));
  await loadLearnedSwaps();
}
