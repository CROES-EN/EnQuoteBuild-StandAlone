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

import {
  salesforceMockAdapter
} from "./adapters/salesforceMockAdapter";

const DATA_SOURCE =
  import.meta.env.VITE_DATA_SOURCE ||
  "base44";

const adapters = {
  base44: base44Adapter,
  mock: mockAdapter,
  local: localAdapter,
  salesforce: salesforceAdapter,
  "salesforce-mock":
    salesforceMockAdapter
};

const adapter =
  adapters[DATA_SOURCE];

if (!adapter) {
  throw new Error(
    `Unsupported VITE_DATA_SOURCE: ${DATA_SOURCE}`
  );
}

const call = (
  methodName,
  args
) => {
  const method =
    adapter[methodName];

  if (
    typeof method !== "function"
  ) {
    throw new Error(
      `${methodName} is not implemented by the ${DATA_SOURCE} adapter.`
    );
  }

  return method(...args);
};

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

export const isSalesforceMockDataSource =
  DATA_SOURCE === "salesforce-mock";

export const getCurrentUser =
  (...args) =>
    call("getCurrentUser", args);

export const getQuotes =
  (...args) =>
    call("getQuotes", args);

export const getQuoteById =
  (...args) =>
    call("getQuoteById", args);

export const listRecentQuotes =
  (...args) =>
    call("listRecentQuotes", args);

export const filterQuotes =
  (...args) =>
    call("filterQuotes", args);

export const createQuote =
  (...args) =>
    call("createQuote", args);

export const updateQuote =
  (...args) =>
    call("updateQuote", args);

export const deleteQuote =
  (...args) =>
    call("deleteQuote", args);

export const bulkUpdateQuotes =
  (...args) =>
    call("bulkUpdateQuotes", args);

export const getProducts =
  (...args) =>
    call("getProducts", args);

export const listProducts =
  (...args) =>
    call("listProducts", args);

export const filterProducts =
  (...args) =>
    call("filterProducts", args);

export const createProduct =
  (...args) =>
    call("createProduct", args);

export const updateProduct =
  (...args) =>
    call("updateProduct", args);

export const deleteProduct =
  (...args) =>
    call("deleteProduct", args);

export const getReviews =
  (...args) =>
    call("getReviews", args);

export const getReviewsForQuote =
  (...args) =>
    call("getReviewsForQuote", args);

export const createReview =
  (...args) =>
    call("createReview", args);

export const updateReview =
  (...args) =>
    call("updateReview", args);

export const getQuoteActivities =
  (...args) =>
    call(
      "getQuoteActivities",
      args
    );

export const createQuoteActivity =
  (...args) =>
    call(
      "createQuoteActivity",
      args
    );

export const getFollowUps =
  (...args) =>
    call("getFollowUps", args);

export const createFollowUp =
  (...args) =>
    call("createFollowUp", args);

export const getUsers =
  (...args) =>
    call("getUsers", args);

export const listLocalCollection =
  (...args) =>
    call(
      "listLocalCollection",
      args
    );

export const createLocalRecord =
  (...args) =>
    call(
      "createLocalRecord",
      args
    );

export const updateLocalRecord =
  (...args) =>
    call(
      "updateLocalRecord",
      args
    );

export const deleteLocalRecord =
  (...args) =>
    call(
      "deleteLocalRecord",
      args
    );

export const exportLocalData =
  (...args) =>
    call("exportLocalData", args);

export const importLocalData =
  (...args) =>
    call("importLocalData", args);

export const resetLocalData =
  (...args) =>
    call("resetLocalData", args);
