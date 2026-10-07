function bridge() {
  if (!globalThis.window?.enquoteLocal) {
    throw new Error("Local Electron persistence is unavailable in this runtime.");
  }
  return globalThis.window.enquoteLocal;
}

function resource(name) {
  const api = bridge()[name];
  if (!api) throw new Error(`Local bridge resource is unavailable: ${name}`);
  return api;
}

// ---------------------------------------------------------------------------
// getCurrentUser() identity resolution
// ---------------------------------------------------------------------------
// FIX for a real, confirmed bug: this previously called
// `bridge().auth?.getCurrentUser?.()`, but preload.cjs's exposed `auth` bridge
// only has `login`/`setPassword` - there is NO `getCurrentUser` method on it at
// all. That call was therefore ALWAYS undefined, so the `||` fallback below it
// ALWAYS fired - meaning every caller of getCurrentUser() (version creation,
// "save as copy", pre-approval toggling, etc.) got the hardcoded demo identity
// (email: "demo.user@example.invalid") no matter who was actually signed in,
// even though the real local sign-in system (src/lib/AuthContext.jsx) was
// correctly tracking the real signed-in person the entire time in a SEPARATE,
// disconnected code path.
//
// Desktop attribution requires the verified identity. Legacy browser sessions may
// use AuthContext's persisted session key, but missing identity must never become a demo user.
const SESSION_EMAIL_KEY = "enquote_local_session_email";

function getPersistedSessionEmail() {
  try {
    return globalThis.window?.localStorage?.getItem(SESSION_EMAIL_KEY) || null;
  } catch {
    return null;
  }
}

// Mirrors AuthContext.jsx's buildUserFromRecord(): prefers a real synced Base44
// "User" record's display_name/full_name for the human-friendly name, falling
// back to just the verified Cloudflare email if no record/name is available.
function buildUserFromRecord(record, fallbackEmail) {
  const email = record?.email || fallbackEmail || "";
  const displayName = record?.display_name || record?.full_name || email;
  return {
    id: record?.id || `local-${email || "user"}`,
    email,
    full_name: displayName,
    name: displayName,
    role: record?.app_role || record?.role || "admin",
    app_role: record?.app_role || record?.role || "admin"
  };
}

async function resolveCurrentUser() {
  const authBridge = globalThis.window?.enquoteLocal?.auth;
  let sessionEmail;
  if (typeof authBridge?.getVerifiedIdentity === "function") {
    const identity = await authBridge.getVerifiedIdentity();
    sessionEmail = identity?.email?.trim().toLowerCase() || null;
    if (!sessionEmail || sessionEmail.toLowerCase().endsWith("@example.invalid")) {
      throw new Error("Verified Cloudflare identity is unavailable. Sign in again before continuing.");
    }
  } else {
    // Browser/dev environments without the Electron auth bridge may still use the
    // legacy local session key. Packaged desktop sessions always use Cloudflare above.
    sessionEmail = getPersistedSessionEmail();
  }
  if (!sessionEmail) {
    throw new Error("Signed-in identity is unavailable. Sign in again before continuing.");
  }

  try {
    const users = await resource("collections").list("users");
    const record = (users || []).find(
      (candidate) => candidate.email?.toLowerCase() === sessionEmail.toLowerCase()
    ) || null;
    return buildUserFromRecord(record, sessionEmail);
  } catch (error) {
    console.warn("Unable to load the signed-in user's profile; using the verified session email.", error);
    // Users list temporarily unavailable - still reflect the REAL signed-in
    // email rather than silently reverting to the demo identity.
    return buildUserFromRecord(null, sessionEmail);
  }
}

export const localAdapter = {
  getCurrentUser: () => resolveCurrentUser(),

  getQuotes: () => resource("quotes").list(),
  getQuoteById: (quoteId) => resource("quotes").get(quoteId),
  listRecentQuotes: (limit = 100) => resource("quotes").list({ limit }),
  filterQuotes: (filters = {}) => resource("quotes").filter(filters),
  createQuote: (data) => resource("quotes").create(data),
  updateQuote: (recordId, data, expectedVersion) => resource("quotes").update(recordId, data, expectedVersion),
  deleteQuote: (recordId) => resource("quotes").delete(recordId),
  bulkUpdateQuotes: (updates) => resource("quotes").bulkUpdate(updates),

  getProducts: () => resource("products").list(),
  listProducts: () => resource("products").list(),
  filterProducts: (filters = {}) => resource("products").filter(filters),
  createProduct: (data) => resource("products").create(data),
  updateProduct: (recordId, data) => resource("products").update(recordId, data),
  deleteProduct: (recordId) => resource("products").delete(recordId),

  // Reviews are a named collection, not a dedicated preload bridge resource.
  getReviews: () => resource("collections").list("reviews"),
  getReviewsForQuote: async (quoteId) => {
    const reviews = await resource("collections").list("reviews");
    return reviews.filter(review => review.quote_id === quoteId);
  },
  createReview: (data) => resource("collections").create("reviews", data),
  updateReview: (recordId, data) => resource("collections").update("reviews", recordId, data),

  getQuoteActivities: (quoteId) =>
    resource("activities").filter({ quote_id: quoteId }),
  getAllQuoteActivities: () => resource("collections").list("activities"),
  createQuoteActivity: (data) => resource("activities").create(data),

  getFollowUps: (quoteId) =>
    quoteId
      ? resource("followUps").filter({ quote_id: quoteId })
      : resource("followUps").list(),
  createFollowUp: (data) => resource("followUps").create(data),
  // Unlike quotes/products, "users" has no dedicated bridge object in
  // preload.cjs - it only ever existed as one of the generic named collections, so route
  // through that bridge instead of the (nonexistent) resource("users").
  getUsers: () => bridge().collections.list("users"),

  listLocalCollection: (name, ...args) => bridge().collections.list(name, ...args),
  createLocalRecord: (name, data) => bridge().collections.create(name, data),
  // Bulk counterpart to createLocalRecord() - creates several records in one call
  // (e.g. StatusAlerts.jsx's "Clear All" button dismissing many alerts at once)
  // instead of requiring one round-trip per record. Uses bridge() (this file's own
  // Electron-bridge accessor, defined above) - NOT "dh()", which does not exist
  // anywhere in this file.
  createLocalRecords: async (name, records) => {
    const results = [];
    for (const record of records) {
      results.push(await bridge().collections.create(name, record));
    }
    return results;
  },
  updateLocalRecord: (name, recordId, data) =>
    bridge().collections.update(name, recordId, data),
  // Shared FST roster: seeds from the bundled roster and syncs with other installs.
  syncFstRoster: () => bridge().fsts.sync(),
  importFstRoster: (rows) => bridge().fsts.importRows(rows),
  deleteLocalRecord: (name, recordId) =>
    bridge().collections.delete(name, recordId),

  // FIXED: these previously called bridge().data.export()/.import()/.reset() - but no
  // "data" object exists anywhere on the real Electron bridge (confirmed directly against
  // preload.cjs), so every call threw "Cannot read properties of undefined". The bridge's
  // REAL, already-working equivalents live under `quotes` (exportData returns the ENTIRE
  // raw local data file, not just quotes - see repository.cjs's exportData()).
  exportLocalData: () => bridge().quotes.exportData(),
  importLocalData: (data) => bridge().quotes.importData(data),
  resetLocalData: () => bridge().quotes.reset()
};
