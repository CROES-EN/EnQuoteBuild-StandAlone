function requireLocalBridge() {
  if (!window.enquoteLocal) {
    throw new Error(
      "Local Electron persistence is unavailable in this runtime."
    );
  }

  return window.enquoteLocal;
}

export const localAdapter = {
  getCurrentUser: async () => ({
    id: "demo-user",
    email: "demo.user@example.invalid",
    full_name: "Demo User",
    role: "admin"
  }),

  getQuotes: () =>
    requireLocalBridge().quotes.list(),

  getQuoteById: (quoteId) =>
    requireLocalBridge().quotes.get(
      quoteId
    ),

  listRecentQuotes: (
    limit = 100
  ) =>
    requireLocalBridge().quotes.list({
      limit
    }),

  filterQuotes: (
    filters = {}
  ) =>
    requireLocalBridge().quotes.filter(
      filters
    ),

  createQuote: (data) =>
    requireLocalBridge().quotes.create(
      data
    ),

  updateQuote: (id, data) =>
    requireLocalBridge().quotes.update(
      id,
      data
    ),

  deleteQuote: (id) =>
    requireLocalBridge().quotes.delete(
      id
    ),

  bulkUpdateQuotes: (updates) =>
    requireLocalBridge().quotes.bulkUpdate(
      updates
    ),

  getProducts: () =>
    requireLocalBridge().products.list(),

  listProducts: () =>
    requireLocalBridge().products.list(),

  filterProducts: (
    filters = {}
  ) =>
    requireLocalBridge().products.filter(
      filters
    ),

  createProduct: (data) =>
    requireLocalBridge().products.create(
      data
    ),

  updateProduct: (id, data) =>
    requireLocalBridge().products.update(
      id,
      data
    ),

  deleteProduct: (id) =>
    requireLocalBridge().products.delete(
      id
    ),

  getReviews: () =>
    requireLocalBridge().reviews.list(),

  getReviewsForQuote: (quoteId) =>
    requireLocalBridge().reviews.filter({
      quote_id: quoteId
    }),

  createReview: (data) =>
    requireLocalBridge().reviews.create(
      data
    ),

  updateReview: (id, data) =>
    requireLocalBridge().reviews.update(
      id,
      data
    ),

  getQuoteActivities: (quoteId) =>
    requireLocalBridge().activities.filter({
      quote_id: quoteId
    }),

  createQuoteActivity: (data) =>
    requireLocalBridge().activities.create(
      data
    ),

  getUsers: () =>
    requireLocalBridge().users.list()
};