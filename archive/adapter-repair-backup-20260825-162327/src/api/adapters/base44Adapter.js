import { base44 } from "../base44Client";

export const base44Adapter = {
  // Authentication
  getCurrentUser: () =>
    base44.auth.me(),

  // Quotes
  getQuotes: async () => {
    const response =
      await base44.functions.invoke("getAllQuotes");

    return response?.data || [];
  },

  getQuoteById: async (quoteId) => {
    const response =
      await base44.functions.invoke(
        "getQuoteById",
        {
          quote_id: quoteId
        }
      );

    return response?.data?.quote || null;
  },

  listRecentQuotes: (limit = 100) =>
    base44.entities.Quote.list(
      "-created_date",
      limit
    ),

  filterQuotes: (filters = {}) =>
    base44.entities.Quote.filter(filters),

  createQuote: (data) =>
    base44.entities.Quote.create(data),

  updateQuote: (id, data) =>
    base44.entities.Quote.update(id, data),

  deleteQuote: (id) =>
    base44.entities.Quote.delete(id),

  bulkUpdateQuotes: (updates) =>
    base44.entities.Quote.bulkUpdate(updates),

  // Products
  getProducts: async () => {
    const response =
      await base44.functions.invoke("getAllProducts");

    return response?.data || [];
  },

  listProducts: (
    sort = "name",
    limit = 2000
  ) =>
    base44.entities.Product.list(
      sort,
      limit
    ),

  filterProducts: (filters = {}) =>
    base44.entities.Product.filter(filters),

  createProduct: (data) =>
    base44.entities.Product.create(data),

  updateProduct: (id, data) =>
    base44.entities.Product.update(id, data),

  deleteProduct: (id) =>
    base44.entities.Product.delete(id),

  // Reviews
  getReviews: (
    sort = "-created_date",
    limit = 2000
  ) =>
    base44.entities.QuoteReview.list(
      sort,
      limit
    ),

  getReviewsForQuote: (quoteId) =>
    base44.entities.QuoteReview.filter({
      quote_id: quoteId
    }),

  createReview: (data) =>
    base44.entities.QuoteReview.create(data),

  updateReview: (id, data) =>
    base44.entities.QuoteReview.update(
      id,
      data
    ),

  // Activities
  getQuoteActivities: (quoteId) =>
    base44.entities.QuoteActivity.filter(
      {
        quote_id: quoteId
      },
      "-action_at",
      100
    ),

  createQuoteActivity: (data) =>
    base44.entities.QuoteActivity.create(
      data
    ),

  // Users
  getUsers: async () => {
    const response =
      await base44.functions.invoke("getAllUsers");

    return response?.data || [];
  }
};