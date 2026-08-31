const clone = (value) => structuredClone(value);

const createId = (prefix) =>
  `${prefix}${Date.now()}${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const now = () => new Date().toISOString();

const originalData = {
  quotes: [
    {
      id: "a00000000000001",
      quote_number: "SF-DEMO-1001",
      name: "SF-DEMO-1001",
      site_id: "SF-DEMO-SITE-01",
      case_number: "SF-CASE-1001",
      status: "submitted",
      total: 2450,
      materials_total: 1550,
      labor_total: 650,
      travel_total: 150,
      sales_tax: 100,
      created_by: "Salesforce Demo Coordinator",
      created_date: "2026-08-20T15:00:00.000Z",
      updated_date: "2026-08-25T18:00:00.000Z",
      is_current_version: true,
      exclude_from_reporting: false,
      version_number: 1,
      parent_quote_id: null,
      scope_of_work:
        "Synthetic Salesforce integration test quote.",
      homeowner_summary:
        "Demonstration repair quote using synthetic data only."
    },
    {
      id: "a00000000000002",
      quote_number: "SF-DEMO-1002",
      name: "SF-DEMO-1002",
      site_id: "SF-DEMO-SITE-02",
      case_number: "SF-CASE-1002",
      status: "approved",
      total: 3875,
      materials_total: 2525,
      labor_total: 900,
      travel_total: 250,
      sales_tax: 200,
      created_by: "Salesforce Demo Coordinator",
      created_date: "2026-08-18T13:00:00.000Z",
      updated_date: "2026-08-24T16:00:00.000Z",
      is_current_version: true,
      exclude_from_reporting: false,
      version_number: 1,
      parent_quote_id: null,
      scope_of_work:
        "Synthetic approved quote for Salesforce adapter testing.",
      homeowner_summary:
        "Demonstration equipment replacement quote."
    },
    {
      id: "a00000000000003",
      quote_number: "SF-DEMO-1003",
      name: "SF-DEMO-1003",
      site_id: "SF-DEMO-SITE-03",
      case_number: "SF-CASE-1003",
      status: "rejected",
      total: 1725,
      materials_total: 950,
      labor_total: 525,
      travel_total: 150,
      sales_tax: 100,
      created_by: "Salesforce Demo Coordinator Two",
      created_date: "2026-08-15T14:00:00.000Z",
      updated_date: "2026-08-22T14:00:00.000Z",
      is_current_version: true,
      exclude_from_reporting: false,
      version_number: 1,
      parent_quote_id: null,
      scope_of_work:
        "Synthetic rejected quote for workflow testing.",
      homeowner_summary:
        "Demonstration service quote."
    }
  ],

  products: [
    {
      id: "01t000000000001",
      sku: "SF-DEMO-SKU-001",
      product_code: "SF-DEMO-SKU-001",
      name: "Demonstration Solar Component",
      description:
        "Synthetic product for Salesforce adapter testing.",
      price: 450,
      unit_price: 450,
      cost: 300,
      active: true,
      is_active: true,
      taxable: true,
      category: "Materials"
    },
    {
      id: "01t000000000002",
      sku: "SF-DEMO-LABOR-001",
      product_code: "SF-DEMO-LABOR-001",
      name: "Demonstration Field Labor",
      description:
        "Synthetic labor item for Salesforce adapter testing.",
      price: 175,
      unit_price: 175,
      cost: 0,
      active: true,
      is_active: true,
      taxable: false,
      category: "Labor"
    }
  ],

  reviews: [
    {
      id: "a10000000000001",
      quote_id: "a00000000000002",
      review_status: "completed",
      decision: "approved",
      comments: "Synthetic Salesforce approval review.",
      created_date: "2026-08-24T16:00:00.000Z",
      updated_date: "2026-08-24T16:00:00.000Z"
    }
  ],

  activities: [],
  followUps: [],

  users: [
    {
      id: "005000000000001",
      name: "Salesforce Demo Manager",
      full_name: "Salesforce Demo Manager",
      email: "demo.manager@example.invalid",
      role: "admin",
      app_role: "admin",
      active: true
    },
    {
      id: "005000000000002",
      name: "Salesforce Demo Coordinator",
      full_name: "Salesforce Demo Coordinator",
      email: "demo.coordinator@example.invalid",
      role: "user",
      app_role: "user",
      active: true
    }
  ],

  siteFlags: [],
  quoteDeletionRequests: [],
  materialOrders: [],
  pvPanelRMAs: [],
  pdfTemplates: [],
  emailDistributions: [],
  statusAlertDismissals: [],
  priceReviews: [],
  svcCancelTracker: []
};

let data = clone(originalData);

const collection = (name) => {
  if (!Array.isArray(data[name])) {
    data[name] = [];
  }

  return data[name];
};

const findRecord = (name, recordId) =>
  collection(name).find(
    (record) =>
      record.id === recordId ||
      record.Id === recordId
  );

const createRecord = (name, record, prefix = "a90") => {
  const created = {
    ...clone(record),
    id: record?.id || record?.Id || createId(prefix),
    created_date: record?.created_date || now(),
    updated_date: now()
  };

  collection(name).push(created);
  return clone(created);
};

const updateRecord = (name, recordId, changes) => {
  const records = collection(name);

  const index = records.findIndex(
    (record) =>
      record.id === recordId ||
      record.Id === recordId
  );

  if (index < 0) {
    throw new Error(
      `Salesforce mock record not found: ${name}/${recordId}`
    );
  }

  records[index] = {
    ...records[index],
    ...clone(changes),
    id: records[index].id || recordId,
    updated_date: now()
  };

  return clone(records[index]);
};

const deleteRecord = (name, recordId) => {
  const records = collection(name);

  const index = records.findIndex(
    (record) =>
      record.id === recordId ||
      record.Id === recordId
  );

  if (index < 0) {
    return false;
  }

  records.splice(index, 1);
  return true;
};

const filterRecords = (name, filters = {}) =>
  clone(
    collection(name).filter((record) =>
      Object.entries(filters).every(
        ([field, value]) =>
          record[field] === value
      )
    )
  );

export const salesforceMockAdapter = {
  getCurrentUser: async () =>
    clone(data.users[0]),

  getQuotes: async () =>
    clone(data.quotes),

  getQuoteById: async (quoteId) =>
    clone(findRecord("quotes", quoteId) || null),

  listRecentQuotes: async (limit = 100) =>
    clone(
      [...data.quotes]
        .sort((a, b) =>
          String(b.created_date || "").localeCompare(
            String(a.created_date || "")
          )
        )
        .slice(0, limit)
    ),

  filterQuotes: async (filters = {}) =>
    filterRecords("quotes", filters),

  createQuote: async (record) =>
    createRecord("quotes", record, "a00"),

  updateQuote: async (quoteId, changes) =>
    updateRecord("quotes", quoteId, changes),

  deleteQuote: async (quoteId) =>
    deleteRecord("quotes", quoteId),

  bulkUpdateQuotes: async (updates = []) =>
    Promise.all(
      updates.map((item) =>
        updateRecord(
          "quotes",
          item.id,
          item.data || item.changes || item
        )
      )
    ),

  getProducts: async () =>
    clone(data.products),

  listProducts: async () =>
    clone(data.products),

  filterProducts: async (filters = {}) =>
    filterRecords("products", filters),

  createProduct: async (record) =>
    createRecord("products", record, "01t"),

  updateProduct: async (productId, changes) =>
    updateRecord("products", productId, changes),

  deleteProduct: async (productId) =>
    deleteRecord("products", productId),

  getReviews: async () =>
    clone(data.reviews),

  getReviewsForQuote: async (quoteId) =>
    filterRecords("reviews", {
      quote_id: quoteId
    }),

  createReview: async (record) =>
    createRecord("reviews", record, "a10"),

  updateReview: async (reviewId, changes) =>
    updateRecord("reviews", reviewId, changes),

  getQuoteActivities: async (quoteId) =>
    filterRecords("activities", {
      quote_id: quoteId
    }),

  createQuoteActivity: async (record) =>
    createRecord("activities", record, "a20"),

  getFollowUps: async (quoteId) =>
    quoteId
      ? filterRecords("followUps", {
          quote_id: quoteId
        })
      : clone(data.followUps),

  createFollowUp: async (record) =>
    createRecord("followUps", record, "a30"),

  getUsers: async () =>
    clone(data.users),

  listLocalCollection: async (name) =>
    clone(collection(name)),

  createLocalRecord: async (name, record) =>
    createRecord(name, record),

  updateLocalRecord: async (
    name,
    recordId,
    changes
  ) =>
    updateRecord(name, recordId, changes),

  deleteLocalRecord: async (name, recordId) =>
    deleteRecord(name, recordId),

  exportLocalData: async () =>
    clone(data),

  importLocalData: async (importedData) => {
    if (
      !importedData ||
      typeof importedData !== "object"
    ) {
      throw new Error(
        "Salesforce mock import requires an object."
      );
    }

    data = clone(importedData);
    return true;
  },

  resetLocalData: async () => {
    data = clone(originalData);
    return true;
  }
};
