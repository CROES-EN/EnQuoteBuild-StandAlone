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

export const localAdapter = {
  getCurrentUser: () =>
    bridge().auth?.getCurrentUser?.() ||
    Promise.resolve({
      id: "demo-user",
      email: "demo.user@example.invalid",
      full_name: "Demo User",
      role: "admin"
    }),

  getQuotes: () => resource("quotes").list(),
  getQuoteById: (quoteId) => resource("quotes").get(quoteId),
  listRecentQuotes: (limit = 100) => resource("quotes").list({ limit }),
  filterQuotes: (filters = {}) => resource("quotes").filter(filters),
  createQuote: (data) => resource("quotes").create(data),
  updateQuote: (recordId, data) => resource("quotes").update(recordId, data),
  deleteQuote: (recordId) => resource("quotes").delete(recordId),
  bulkUpdateQuotes: (updates) => resource("quotes").bulkUpdate(updates),

  getProducts: () => resource("products").list(),
  listProducts: () => resource("products").list(),
  filterProducts: (filters = {}) => resource("products").filter(filters),
  createProduct: (data) => resource("products").create(data),
  updateProduct: (recordId, data) => resource("products").update(recordId, data),
  deleteProduct: (recordId) => resource("products").delete(recordId),

  getReviews: () => resource("reviews").list(),
  getReviewsForQuote: (quoteId) => resource("reviews").filter({ quote_id: quoteId }),
  createReview: (data) => resource("reviews").create(data),
  updateReview: (recordId, data) => resource("reviews").update(recordId, data),

  getQuoteActivities: (quoteId) =>
    resource("activities").filter({ quote_id: quoteId }),
  createQuoteActivity: (data) => resource("activities").create(data),

  getFollowUps: (quoteId) =>
    quoteId
      ? resource("followUps").filter({ quote_id: quoteId })
      : resource("followUps").list(),
  createFollowUp: (data) => resource("followUps").create(data),
  getUsers: () => resource("users").list(),

  listLocalCollection: (name, ...args) => bridge().collections.list(name, ...args),
  createLocalRecord: (name, data) => bridge().collections.create(name, data),
  updateLocalRecord: (name, recordId, data) =>
    bridge().collections.update(name, recordId, data),
  deleteLocalRecord: (name, recordId) =>
    bridge().collections.delete(name, recordId),

  exportLocalData: () => bridge().data.export(),
  importLocalData: (data) => bridge().data.import(data),
  resetLocalData: () => bridge().data.reset()
};