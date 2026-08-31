const notConfigured = (methodName) => {
  throw new Error(
    `${methodName} cannot run because Salesforce integration is deferred pending SFDC admin approval, sandbox access, OAuth PKCE configuration, API permissions, object mappings, and security review.`
  );
};

export const salesforceAdapter = {
  getCurrentUser: () =>
    notConfigured("getCurrentUser"),

  getQuotes: () =>
    notConfigured("getQuotes"),

  getQuoteById: () =>
    notConfigured("getQuoteById"),

  listRecentQuotes: () =>
    notConfigured("listRecentQuotes"),

  filterQuotes: () =>
    notConfigured("filterQuotes"),

  createQuote: () =>
    notConfigured("createQuote"),

  updateQuote: () =>
    notConfigured("updateQuote"),

  deleteQuote: () =>
    notConfigured("deleteQuote"),

  bulkUpdateQuotes: () =>
    notConfigured("bulkUpdateQuotes"),

  getProducts: () =>
    notConfigured("getProducts"),

  listProducts: () =>
    notConfigured("listProducts"),

  filterProducts: () =>
    notConfigured("filterProducts"),

  createProduct: () =>
    notConfigured("createProduct"),

  updateProduct: () =>
    notConfigured("updateProduct"),

  deleteProduct: () =>
    notConfigured("deleteProduct"),

  getReviews: () =>
    notConfigured("getReviews"),

  getReviewsForQuote: () =>
    notConfigured("getReviewsForQuote"),

  createReview: () =>
    notConfigured("createReview"),

  updateReview: () =>
    notConfigured("updateReview"),

  getQuoteActivities: () =>
    notConfigured("getQuoteActivities"),

  createQuoteActivity: () =>
    notConfigured("createQuoteActivity"),

  getUsers: () =>
    notConfigured("getUsers")
};