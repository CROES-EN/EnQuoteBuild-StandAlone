import {
  base44Adapter
} from "./base44Adapter";

import {
  salesforceMockAdapter
} from "./salesforceMockAdapter";

const SYNC_LOG_KEY =
  "enquote_salesforce_mock_sync_log";

const readSyncLog = () => {
  try {
    return JSON.parse(
      localStorage.getItem(SYNC_LOG_KEY) ||
      "[]"
    );
  } catch {
    return [];
  }
};

const writeSyncLog = (entry) => {
  try {
    const log = readSyncLog();

    log.unshift({
      timestamp:
        new Date().toISOString(),
      ...entry
    });

    localStorage.setItem(
      SYNC_LOG_KEY,
      JSON.stringify(
        log.slice(0, 250)
      )
    );
  } catch {
    // Sync logging must never block Base44.
  }
};

const mirror = async (
  operation,
  callback,
  context = {}
) => {
  try {
    const result = await callback();

    writeSyncLog({
      operation,
      status: "success",
      ...context
    });

    return result;
  } catch (error) {
    writeSyncLog({
      operation,
      status: "failed",
      message:
        error?.message ||
        String(error),
      ...context
    });

    console.warn(
      `[Salesforce Mock] ${operation} failed:`,
      error
    );

    return null;
  }
};

const mirrorUpdateOrCreate = async (
  updateMethod,
  createMethod,
  id,
  data
) => {
  try {
    return await updateMethod(
      id,
      data
    );
  } catch {
    return createMethod({
      ...data,
      id
    });
  }
};

export const base44DualAdapter = {
  getCurrentUser: (...args) =>
    base44Adapter.getCurrentUser(
      ...args
    ),

  getQuotes: (...args) =>
    base44Adapter.getQuotes(
      ...args
    ),

  getQuoteById: (...args) =>
    base44Adapter.getQuoteById(
      ...args
    ),

  listRecentQuotes: (...args) =>
    base44Adapter.listRecentQuotes(
      ...args
    ),

  filterQuotes: (...args) =>
    base44Adapter.filterQuotes(
      ...args
    ),

  createQuote: async (data) => {
    const saved =
      await base44Adapter.createQuote(
        data
      );

    await mirror(
      "createQuote",
      () =>
        salesforceMockAdapter.createQuote({
          ...data,
          ...saved,
          id: saved?.id
        }),
      {
        base44Id: saved?.id
      }
    );

    return saved;
  },

  updateQuote: async (
    id,
    data
  ) => {
    const saved =
      await base44Adapter.updateQuote(
        id,
        data
      );

    await mirror(
      "updateQuote",
      () =>
        mirrorUpdateOrCreate(
          salesforceMockAdapter.updateQuote,
          salesforceMockAdapter.createQuote,
          id,
          {
            ...data,
            ...saved,
            id
          }
        ),
      {
        base44Id: id
      }
    );

    return saved;
  },

  deleteQuote: async (id) => {
    const result =
      await base44Adapter.deleteQuote(
        id
      );

    await mirror(
      "deleteQuote",
      () =>
        salesforceMockAdapter.deleteQuote(
          id
        ),
      {
        base44Id: id
      }
    );

    return result;
  },

  bulkUpdateQuotes: async (
    updates
  ) => {
    const result =
      await base44Adapter.bulkUpdateQuotes(
        updates
      );

    await mirror(
      "bulkUpdateQuotes",
      () =>
        Promise.all(
          updates.map(
            (item) =>
              mirrorUpdateOrCreate(
                salesforceMockAdapter.updateQuote,
                salesforceMockAdapter.createQuote,
                item.id,
                item.data ||
                item.changes ||
                item
              )
          )
        ),
      {
        recordCount:
          updates?.length || 0
      }
    );

    return result;
  },

  getProducts: (...args) =>
    base44Adapter.getProducts(
      ...args
    ),

  listProducts: (...args) =>
    base44Adapter.listProducts(
      ...args
    ),

  filterProducts: (...args) =>
    base44Adapter.filterProducts(
      ...args
    ),

  createProduct: async (data) => {
    const saved =
      await base44Adapter.createProduct(
        data
      );

    await mirror(
      "createProduct",
      () =>
        salesforceMockAdapter.createProduct({
          ...data,
          ...saved,
          id: saved?.id
        }),
      {
        base44Id: saved?.id
      }
    );

    return saved;
  },

  updateProduct: async (
    id,
    data
  ) => {
    const saved =
      await base44Adapter.updateProduct(
        id,
        data
      );

    await mirror(
      "updateProduct",
      () =>
        mirrorUpdateOrCreate(
          salesforceMockAdapter.updateProduct,
          salesforceMockAdapter.createProduct,
          id,
          {
            ...data,
            ...saved,
            id
          }
        ),
      {
        base44Id: id
      }
    );

    return saved;
  },

  deleteProduct: async (id) => {
    const result =
      await base44Adapter.deleteProduct(
        id
      );

    await mirror(
      "deleteProduct",
      () =>
        salesforceMockAdapter.deleteProduct(
          id
        ),
      {
        base44Id: id
      }
    );

    return result;
  },

  getReviews: (...args) =>
    base44Adapter.getReviews(
      ...args
    ),

  getReviewsForQuote: (...args) =>
    base44Adapter.getReviewsForQuote(
      ...args
    ),

  createReview: async (data) => {
    const saved =
      await base44Adapter.createReview(
        data
      );

    await mirror(
      "createReview",
      () =>
        salesforceMockAdapter.createReview({
          ...data,
          ...saved,
          id: saved?.id
        }),
      {
        base44Id: saved?.id,
        quoteId:
          data?.quote_id
      }
    );

    return saved;
  },

  updateReview: async (
    id,
    data
  ) => {
    const saved =
      await base44Adapter.updateReview(
        id,
        data
      );

    await mirror(
      "updateReview",
      () =>
        mirrorUpdateOrCreate(
          salesforceMockAdapter.updateReview,
          salesforceMockAdapter.createReview,
          id,
          {
            ...data,
            ...saved,
            id
          }
        ),
      {
        base44Id: id
      }
    );

    return saved;
  },

  getQuoteActivities: (...args) =>
    base44Adapter.getQuoteActivities(
      ...args
    ),

  createQuoteActivity: async (
    data
  ) => {
    const saved =
      await base44Adapter
        .createQuoteActivity(
          data
        );

    await mirror(
      "createQuoteActivity",
      () =>
        salesforceMockAdapter
          .createQuoteActivity({
            ...data,
            ...saved,
            id: saved?.id
          }),
      {
        base44Id: saved?.id,
        quoteId:
          data?.quote_id
      }
    );

    return saved;
  },

  getFollowUps: (...args) =>
    base44Adapter.getFollowUps(
      ...args
    ),

  createFollowUp: async (
    data
  ) => {
    const saved =
      await base44Adapter
        .createFollowUp(
          data
        );

    await mirror(
      "createFollowUp",
      () =>
        salesforceMockAdapter
          .createFollowUp({
            ...data,
            ...saved,
            id: saved?.id
          }),
      {
        base44Id: saved?.id,
        quoteId:
          data?.quote_id
      }
    );

    return saved;
  },

  getUsers: (...args) =>
    base44Adapter.getUsers(
      ...args
    ),

  listLocalCollection: (...args) =>
    base44Adapter.listLocalCollection(
      ...args
    ),

  createLocalRecord: async (
    name,
    data
  ) => {
    const saved =
      await base44Adapter
        .createLocalRecord(
          name,
          data
        );

    await mirror(
      "createLocalRecord",
      () =>
        salesforceMockAdapter
          .createLocalRecord(
            name,
            {
              ...data,
              ...saved,
              id: saved?.id
            }
          ),
      {
        collection: name,
        base44Id: saved?.id
      }
    );

    return saved;
  },

  updateLocalRecord: async (
    name,
    id,
    data
  ) => {
    const saved =
      await base44Adapter
        .updateLocalRecord(
          name,
          id,
          data
        );

    await mirror(
      "updateLocalRecord",
      () =>
        salesforceMockAdapter
          .updateLocalRecord(
            name,
            id,
            {
              ...data,
              ...saved
            }
          )
          .catch(() =>
            salesforceMockAdapter
              .createLocalRecord(
                name,
                {
                  ...data,
                  ...saved,
                  id
                }
              )
          ),
      {
        collection: name,
        base44Id: id
      }
    );

    return saved;
  },

  deleteLocalRecord: async (
    name,
    id
  ) => {
    const result =
      await base44Adapter
        .deleteLocalRecord(
          name,
          id
        );

    await mirror(
      "deleteLocalRecord",
      () =>
        salesforceMockAdapter
          .deleteLocalRecord(
            name,
            id
          ),
      {
        collection: name,
        base44Id: id
      }
    );

    return result;
  },

  exportLocalData: (...args) =>
    salesforceMockAdapter
      .exportLocalData(
        ...args
      ),

  importLocalData: (...args) =>
    salesforceMockAdapter
      .importLocalData(
        ...args
      ),

  resetLocalData: async () => {
    localStorage.removeItem(
      SYNC_LOG_KEY
    );

    return salesforceMockAdapter
      .resetLocalData();
  },

  getSalesforceMockSyncLog: async () =>
    readSyncLog()
};
