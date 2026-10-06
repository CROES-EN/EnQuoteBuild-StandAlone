import {base44Adapter} from "./base44Adapter";

import {salesforceMockAdapter} from "./salesforceMockAdapter";

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

// Base44 is the primary source of truth in this mode, but every write is ALSO mirrored,
// best-effort, into the local Electron JSON file (enquote-data-v1.json) so there's
// always an on-disk backup copy that survives even if Base44 is unreachable. This mirror
// must never throw or block the UI - if it's unavailable (e.g. running in a plain browser
// tab without the Electron bridge) or fails for any reason, we log and move on silently.
const localBridge = () => globalThis.window?.enquoteLocal || null;

const mirrorToLocalJson = async (operation, callback) => {
  const bridge = localBridge();
  if (!bridge) return;

  try {
    await callback(bridge);
  } catch (error) {
    console.warn(
      `[Local JSON backup] ${operation} failed:`,
      error?.message || error
    );
  }
};

const mirrorLocalUpdateOrCreate = async (
  bridge,
  resourceName,
  id,
  data
) => {
  try {
    await bridge[resourceName].update(id, data);
  } catch {
    await bridge[resourceName].create({ ...data, id });
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

    await mirrorToLocalJson(
      "createQuote",
      (bridge) => bridge.quotes.create({ ...data, ...saved, id: saved?.id })
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

    await mirrorToLocalJson(
      "updateQuote",
      (bridge) =>
        mirrorLocalUpdateOrCreate(bridge, "quotes", id, {
          ...data,
          ...saved,
          id
        })
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

    await mirrorToLocalJson(
      "deleteQuote",
      (bridge) => bridge.quotes.delete(id)
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

    await mirrorToLocalJson(
      "bulkUpdateQuotes",
      (bridge) =>
        Promise.all(
          updates.map((item) =>
            mirrorLocalUpdateOrCreate(
              bridge,
              "quotes",
              item.id,
              item.data || item.changes || item
            )
          )
        )
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

    await mirrorToLocalJson(
      "createProduct",
      (bridge) => bridge.products.create({ ...data, ...saved, id: saved?.id })
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

    await mirrorToLocalJson(
      "updateProduct",
      (bridge) =>
        mirrorLocalUpdateOrCreate(bridge, "products", id, {
          ...data,
          ...saved,
          id
        })
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

    await mirrorToLocalJson(
      "deleteProduct",
      (bridge) => bridge.products.delete(id)
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

    await mirrorToLocalJson(
      "createReview",
      (bridge) => bridge.collections.create("reviews", { ...data, ...saved, id: saved?.id })
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

    await mirrorToLocalJson(
      "updateReview",
      async (bridge) => {
        try {
          await bridge.collections.update("reviews", id, { ...data, ...saved, id });
        } catch {
          await bridge.collections.create("reviews", { ...data, ...saved, id });
        }
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

    await mirrorToLocalJson(
      "createQuoteActivity",
      (bridge) => bridge.collections.create("activities", { ...data, ...saved, id: saved?.id })
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

    await mirrorToLocalJson(
      "createFollowUp",
      (bridge) => bridge.collections.create("followUps", { ...data, ...saved, id: saved?.id })
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
  getAllQuoteActivities: () => base44Adapter.getAllQuoteActivities(),

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

    await mirrorToLocalJson(
      "createLocalRecord",
      (bridge) => bridge.collections.create(name, { ...data, ...saved, id: saved?.id })
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

    await mirrorToLocalJson(
      "updateLocalRecord",
      async (bridge) => {
        try {
          await bridge.collections.update(name, id, { ...data, ...saved, id });
        } catch {
          await bridge.collections.create(name, { ...data, ...saved, id });
        }
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

    await mirrorToLocalJson(
      "deleteLocalRecord",
      (bridge) => bridge.collections.delete(name, id)
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
