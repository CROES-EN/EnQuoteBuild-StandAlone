import { base44 } from "../base44Client";

const ENTITY_ALIASES = {
  quotes: "Quote",
  quote: "Quote",
  products: "Product",
  product: "Product",
  reviews: "QuoteReview",
  quoteReviews: "QuoteReview",
  activities: "QuoteActivity",
  quoteActivities: "QuoteActivity",
  followUps: "FollowUpLog",
  followUpLogs: "FollowUpLog",
  users: "User",
  siteFlags: "SiteFlag",
  quoteDeletionRequests: "QuoteDeletionRequest",
  materialOrders: "MaterialOrder",
  pvPanelRMAs: "PVPanelRMA",
  pdfTemplates: "PDFTemplate",
  emailDistributions: "EmailDistribution",
  statusAlertDismissals: "StatusAlertDismissal",
  priceReviews: "PriceReview",
  svcCancelTracker: "SVCancelTracker"
};

function resolveEntity(collectionName) {
  const name = ENTITY_ALIASES[collectionName] || collectionName;
  const entity = base44.entities?.[name];

  if (!entity) {
    throw new Error(`Base44 entity is not configured for collection: ${collectionName}`);
  }

  return entity;
}

export const base44Adapter = {
  getCurrentUser: () => base44.auth.me(),

  getQuotes: async () => {
  const response = await base44.functions.invoke("getAllQuotes");
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.quotes)) return data.quotes;
  return [];
},

  getQuoteById: async (quoteId) => {
    const response = await base44.functions.invoke("getQuoteById", {
      quote_id: quoteId
    });
    return response?.data?.quote || response?.data || null;
  },

  listRecentQuotes: (limit = 100) =>
    base44.entities.Quote.list("-created_date", limit),

  filterQuotes: (filters = {}) =>
    base44.entities.Quote.filter(filters),

  createQuote: (data) => base44.entities.Quote.create(data),
  updateQuote: (id, data) => base44.entities.Quote.update(id, data),
  deleteQuote: (id) => base44.entities.Quote.delete(id),
  bulkUpdateQuotes: (updates) => base44.entities.Quote.bulkUpdate(updates),

  getProducts: async () => {
  const response = await base44.functions.invoke("getAllProducts");
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  return [];
},

  listProducts: (sort = "name", limit = 2000) =>
    base44.entities.Product.list(sort, limit),

  filterProducts: (filters = {}) =>
    base44.entities.Product.filter(filters),

  createProduct: (data) => base44.entities.Product.create(data),
  updateProduct: (id, data) => base44.entities.Product.update(id, data),
  deleteProduct: (id) => base44.entities.Product.delete(id),

  getReviews: (sort = "-created_date", limit = 2000) =>
    base44.entities.QuoteReview.list(sort, limit),

  getReviewsForQuote: (quoteId) =>
    base44.entities.QuoteReview.filter({ quote_id: quoteId }),

  createReview: (data) => base44.entities.QuoteReview.create(data),
  updateReview: (id, data) => base44.entities.QuoteReview.update(id, data),

  getQuoteActivities: (quoteId) =>
    base44.entities.QuoteActivity.filter(
      { quote_id: quoteId },
      "-action_at",
      100
    ),

  createQuoteActivity: (data) =>
    base44.entities.QuoteActivity.create(data),

  getFollowUps: (quoteId) =>
    quoteId
      ? base44.entities.FollowUpLog.filter(
          { quote_id: quoteId },
          "-created_date",
          200
        )
      : base44.entities.FollowUpLog.list("-created_date", 200),

  createFollowUp: (data) => base44.entities.FollowUpLog.create(data),

  getUsers: async () => {
    const response = await base44.functions.invoke("getAllUsers");
    return response?.data || [];
  },

  listLocalCollection: (collectionName, sort = "-created_date", limit = 2000) =>
    resolveEntity(collectionName).list(sort, limit),

  createLocalRecord: (collectionName, data) =>
    resolveEntity(collectionName).create(data),

  updateLocalRecord: (collectionName, id, data) =>
    resolveEntity(collectionName).update(id, data),

  deleteLocalRecord: (collectionName, id) =>
    resolveEntity(collectionName).delete(id),

  exportLocalData: async () => {
    throw new Error("Local Only");
  },

  importLocalData: async () => {
    throw new Error("Local Only");
  },
  resetLocalData: async () => {
    throw new Error("Local Only");
  }
};
