import { workerRequest, browserApi } from "../workerClient.js";
import { entityForCollection, ENTITY_COLLECTIONS } from "../../../shared/entityCollections.js";

let snapshot;
let snapshotAt = 0;
let pending;
let generation = 0;
const TTL = 30000;
const SHARED = new Set(["rmas", "pvManufacturers"]);
const sharedBridge = name => SHARED.has(name) && globalThis.window?.enquoteLocal?.isBrowser
  ? globalThis.window.enquoteLocal.collections : null;
export function invalidateWorkerSnapshot() {
  generation++;
  snapshot = undefined;
  snapshotAt = 0;
  pending = undefined;
}

export async function fetchWorkerSnapshot({ force = false } = {}) {
  if (!force && snapshot && Date.now() - snapshotAt < TTL) return snapshot;
  if (pending) return pending;
  const epoch = generation;
  const request = workerRequest("/api/web-snapshot").then(result => {
    if (!result.entities || !Array.isArray(result.quotes)) throw new Error("The shared snapshot is incomplete.");
    if (generation === epoch) {
      snapshot = result;
      snapshotAt = Date.now();
    }
    return result;
  }).finally(() => { if (pending === request) pending = undefined; });
  pending = request;
  return request;
}

async function collection(name) {
  if (sharedBridge(name)) return sharedBridge(name).list(name);
  const type = entityForCollection(name);
  if (!type) throw new Error(`Unknown shared collection: ${name}`);
  const data = await fetchWorkerSnapshot();
  return data[ENTITY_COLLECTIONS[type]] || data.entities[type] || [];
}

function sorted(records, sort, limit) {
  const field = sort?.replace(/^-/, "");
  const direction = sort?.startsWith("-") ? -1 : 1;
  const result = field ? [...records].sort((a, b) => {
    if (a[field] === b[field]) return 0;
    if (a[field] == null) return 1;
    if (b[field] == null) return -1;
    return (a[field] < b[field] ? -1 : 1) * direction;
  }) : records;
  return limit == null ? result : result.slice(0, limit);
}
const filter = (records, filters = {}) => records.filter(record =>
  Object.entries(filters).every(([key, value]) => record[key] === value)
);

async function write(name, action, record, expectedVersion) {
  const collectionName = ENTITY_COLLECTIONS[entityForCollection(name)];
  const bridge = sharedBridge(collectionName);
  if (bridge) {
    if (action === "delete") return bridge.delete(collectionName, record.id);
    return action === "create" ? bridge.create(collectionName, record) : bridge.update(collectionName, record.id, record);
  }
  const entityType = entityForCollection(name);
  if (!entityType) throw new Error(`Unknown shared collection: ${name}`);
  if (entityType === "User" && action === "update") {
    const { id, ...changes } = record;
    const result = await browserApi("/api/profiles/update", { method: "POST", body: { id, changes } });
    invalidateWorkerSnapshot();
    globalThis.window?.dispatchEvent(new Event("enquote:data-updated"));
    return result.record;
  }
  const response = await workerRequest("/api/web-entities", {
    method: "POST", body: { entityType, action, record, expectedVersion }
  });
  if (!response.record?.id) throw new Error("The shared service did not confirm the saved record.");
  invalidateWorkerSnapshot();
  globalThis.window?.dispatchEvent(new Event("enquote:data-updated"));
  return response.record;
}

export const workerAdapter = {
  getCurrentUser: async () => {
    const policy = await browserApi("/api/access/policy");
    if (!policy.me?.email) throw new Error("Your shared user profile is unavailable.");
    return policy.me;
  },
  getQuotes: () => collection("quotes"),
  getQuoteById: async id => (await collection("quotes")).find(record => String(record.id) === String(id)) || null,
  listRecentQuotes: async (limit = 100) => sorted(await collection("quotes"), "-created_date", limit),
  filterQuotes: async filters => filter(await collection("quotes"), filters),
  createQuote: data => write("Quote", "create", data),
  updateQuote: (id, data, expectedVersion) => write("Quote", "update", { ...data, id }, expectedVersion),
  deleteQuote: id => write("Quote", "delete", { id }),
  bulkUpdateQuotes: async (updates = []) => {
    const results = [];
    for (const { id, changes, data, ...fields } of updates) {
      results.push(await write("Quote", "update", { ...(changes || data || fields), id }));
    }
    return results;
  },
  getProducts: () => collection("products"),
  listProducts: async (sort = "name", limit = 2000) => sorted(await collection("products"), sort, limit),
  filterProducts: async filters => filter(await collection("products"), filters),
  createProduct: data => write("Product", "create", data),
  updateProduct: (id, data) => write("Product", "update", { ...data, id }),
  deleteProduct: id => write("Product", "delete", { id }),
  getReviews: async (sort = "-created_date", limit = 2000) => sorted(await collection("reviews"), sort, limit),
  getReviewsForQuote: async id => filter(await collection("reviews"), { quote_id: id }),
  createReview: data => write("QuoteReview", "create", data),
  updateReview: (id, data) => write("QuoteReview", "update", { ...data, id }),
  getQuoteActivities: async id => sorted(filter(await collection("activities"), { quote_id: id }), "-action_at", 100),
  getAllQuoteActivities: () => collection("activities"),
  createQuoteActivity: data => write("QuoteActivity", "create", data),
  getFollowUps: async id => sorted(filter(await collection("followUps"), id ? { quote_id: id } : {}), "-created_date", 200),
  createFollowUp: data => write("FollowUpLog", "create", data),
  getUsers: async () => (await browserApi("/api/users")).users,
  listLocalCollection: async (name, sort = "-created_date", limit = 2000) => sorted(await collection(name), sort, limit),
  createLocalRecord: (name, data) => write(name, "create", data),
  createLocalRecords: async (name, records) => {
    const results = [];
    for (const record of records) results.push(await write(name, "create", record));
    return results;
  },
  updateLocalRecord: (name, id, data) => write(name, "update", { ...data, id }),
  deleteLocalRecord: (name, id) => write(name, "delete", { id }),
  syncFstRoster: () => browserApi("/api/fsts"),
  importFstRoster: rows => browserApi("/api/fsts/upsert", {
    method: "POST", body: { records: rows.map(record => ({ ...record, id: record.id || crypto.randomUUID(), updated_date: new Date().toISOString() })) }
  }),
  exportLocalData: () => fetchWorkerSnapshot({ force: true }),
  importLocalData: () => { throw new Error("Bulk restore is restricted to the desktop administrator tools."); },
  resetLocalData: () => { throw new Error("Shared production data cannot be reset from this client."); }
};
