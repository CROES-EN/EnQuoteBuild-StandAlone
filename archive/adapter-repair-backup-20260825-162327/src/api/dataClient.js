import {
  base44Adapter
} from "./adapters/base44Adapter";

import {
  mockAdapter
} from "./adapters/mockAdapter";

import {
  localAdapter
} from "./adapters/localAdapter";

import {
  salesforceAdapter
} from "./adapters/salesforceAdapter";

const DATA_SOURCE =
  import.meta.env.VITE_DATA_SOURCE ||
  "base44";

const adapters = {
  base44: base44Adapter,
  mock: mockAdapter,
  local: localAdapter,
  salesforce: salesforceAdapter
};

const adapter = adapters[DATA_SOURCE];

if (!adapter) {
  throw new Error(
    `Unsupported VITE_DATA_SOURCE: ${DATA_SOURCE}`
  );
}

function requireMethod(methodName) {
  const method = adapter[methodName];

  if (typeof method !== "function") {
    throw new Error(
      `${methodName} is not implemented by the ${DATA_SOURCE} adapter.`
    );
  }

  return method;
}

// Data-source information
export const getDataSource = () =>
  DATA_SOURCE;

export const isBase44DataSource =
  DATA_SOURCE === "base44";

export const isMockDataSource =
  DATA_SOURCE === "mock";

export const isLocalDataSource =
  DATA_SOURCE === "local";

export const isSalesforceDataSource =
  DATA_SOURCE === "salesforce";

// Authentication
export const getCurrentUser = (...args) =>
  requireMethod("getCurrentUser")(
    ...args
  );

// Quotes
export const getQuotes = (...args) =>
  requireMethod("getQuotes")(
    ...args
  );

export const getQuoteById = (...args) =>
  requireMethod("getQuoteById")(
    ...args
  );

export const listRecentQuotes = (...args) =>
  requireMethod("listRecentQuotes")(
    ...args
  );

export const filterQuotes = (...args) =>
  requireMethod("filterQuotes")(
    ...args
  );

export const createQuote = (...args) =>
  requireMethod("createQuote")(
    ...args
  );

export const updateQuote = (...args) =>
  requireMethod("updateQuote")(
    ...args
  );

export const deleteQuote = (...args) =>
  requireMethod("deleteQuote")(
    ...args
  );

export const bulkUpdateQuotes = (...args) =>
  requireMethod("bulkUpdateQuotes")(
    ...args
  );

// Products
export const getProducts = (...args) =>
  requireMethod("getProducts")(
    ...args
  );

export const listProducts = (...args) =>
  requireMethod("listProducts")(
    ...args
  );

export const filterProducts = (...args) =>
  requireMethod("filterProducts")(
    ...args
  );

export const createProduct = (...args) =>
  requireMethod("createProduct")(
    ...args
  );

export const updateProduct = (...args) =>
  requireMethod("updateProduct")(
    ...args
  );

export const deleteProduct = (...args) =>
  requireMethod("deleteProduct")(
    ...args
  );

// Reviews
export const getReviews = (...args) =>
  requireMethod("getReviews")(
    ...args
  );

export const getReviewsForQuote = (...args) =>
  requireMethod("getReviewsForQuote")(
    ...args
  );

export const createReview = (...args) =>
  requireMethod("createReview")(
    ...args
  );

export const updateReview = (...args) =>
  requireMethod("updateReview")(
    ...args
  );

// Activities
export const getQuoteActivities = (...args) =>
  requireMethod("getQuoteActivities")(
    ...args
  );

export const createQuoteActivity = (...args) =>
  requireMethod("createQuoteActivity")(
    ...args
  );

// Users
export const getUsers = (...args) =>
  requireMethod("getUsers")(
    ...args
  );