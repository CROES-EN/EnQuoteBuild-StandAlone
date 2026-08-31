import {
  mockQuotes
} from "../../mockData/quotes";

import {
  mockProducts
} from "../../mockData/products";

import {
  mockUsers
} from "../../mockData/users";

import {
  mockReviews
} from "../../mockData/reviews";

const copy = (value) =>
  structuredClone(value);

const mockWriteNotImplemented =
  (methodName) => {
    throw new Error(
      `${methodName} requires the local persistence adapter.`
    );
  };

export const mockAdapter = {
  getCurrentUser: async () => ({
    id: "demo-user",
    email: "demo.user@example.invalid",
    full_name: "Demo User",
    role: "admin"
  }),

  getQuotes: async () =>
    copy(mockQuotes),

  getQuoteById: async (quoteId) =>
    copy(
      mockQuotes.find(
        quote => quote.id === quoteId
      ) || null
    ),

  listRecentQuotes: async (
    limit = 100
  ) =>
    copy(
      mockQuotes.slice(0, limit)
    ),

  filterQuotes: async (
    filters = {}
  ) =>
    copy(
      mockQuotes.filter(quote =>
        Object.entries(filters).every(
          ([field, value]) =>
            quote[field] === value
        )
      )
    ),

  createQuote: async () =>
    mockWriteNotImplemented(
      "createQuote"
    ),

  updateQuote: async () =>
    mockWriteNotImplemented(
      "updateQuote"
    ),

  deleteQuote: async () =>
    mockWriteNotImplemented(
      "deleteQuote"
    ),

  bulkUpdateQuotes: async () =>
    mockWriteNotImplemented(
      "bulkUpdateQuotes"
    ),

  getProducts: async () =>
    copy(mockProducts),

  listProducts: async () =>
    copy(mockProducts),

  filterProducts: async (
    filters = {}
  ) =>
    copy(
      mockProducts.filter(product =>
        Object.entries(filters).every(
          ([field, value]) =>
            product[field] === value
        )
      )
    ),

  createProduct: async () =>
    mockWriteNotImplemented(
      "createProduct"
    ),

  updateProduct: async () =>
    mockWriteNotImplemented(
      "updateProduct"
    ),

  deleteProduct: async () =>
    mockWriteNotImplemented(
      "deleteProduct"
    ),

  getReviews: async () =>
    copy(mockReviews)