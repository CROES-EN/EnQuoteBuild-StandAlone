const now = () => new Date().toISOString();

const createId = (prefix = "a00") =>
  `${prefix}${Date.now()}${Math.random()
    .toString(36)
    .slice(2, 7)}`;

const clone = (value) =>
  structuredClone(value);

const salesforceRecords = {
  quotes: [
    {
      Id: "a00000000000001",
      Name: "SF-DEMO-1001",
      Site_ID__c: "SF-DEMO-SITE-01",
      Case_Number__c: "SF-CASE-1001",
      Status__c: "submitted",
      Total_Amount__c: 2450,
      Materials_Total__c: 1550,
      Labor_Total__c: 650,
      Travel_Total__c: 150,
      Sales_Tax__c: 100,
      Created_By_Name__c: "Demo Coordinator",
      CreatedDate: "2026-08-20T15:00:00.000Z",
      LastModifiedDate: "2026-08-25T18:00:00.000Z",
      Current_Version__c: true,
      Exclude_From_Reporting__c: false,
      Version_Number__c: 1,
      Parent_Quote_ID__c: null,
      Scope_of_Work__c:
        "Synthetic Salesforce integration test quote.",
      Homeowner_Summary__c:
        "Demonstration repair quote using synthetic data only."
    },
    {
      Id: "a00000000000002",
      Name: "SF-DEMO-1002",
      Site_ID__c: "SF-DEMO-SITE-02",
      Case_Number__c: "SF-CASE-1002",
      Status__c: "approved",
      Total_Amount__c: 3875,
      Materials_Total__c: 2525,
      Labor_Total__c: 900,
      Travel_Total__c: 250,
      Sales_Tax__c: 200,
      Created_By_Name__c: "Demo Coordinator",
      CreatedDate: "2026-08-18T13:00:00.000Z",
      LastModifiedDate: "2026-08-24T16:00:00.000Z",
      Current_Version__c: true,
      Exclude_From_Reporting__c: false,
      Version_Number__c: 1,
      Parent_Quote_ID__c: null,
      Scope_of_Work__c:
        "Synthetic approved quote for adapter testing.",
      Homeowner_Summary__c:
        "Demonstration equipment replacement quote."
    },
    {
      Id: "a00000000000003",
      Name: "SF-DEMO-1003",
      Site_ID__c: "SF-DEMO-SITE-03",
      Case_Number__c: "SF-CASE-1003",
      Status__c: "rejected",
      Total_Amount__c: 1725,
      Materials_Total__c: 950,
      Labor_Total__c: 525,
      Travel_Total__c: 150,
      Sales_Tax__c: 100,
      Created_By_Name__c: "Demo Coordinator Two",
      CreatedDate: "2026-08-15T14:00:00.000Z",
      LastModifiedDate: "2026-08-22T14:00:00.000Z",
      Current_Version__c: true,
      Exclude_From_Reporting__c: false,
      Version_Number__c: 1,
      Parent_Quote_ID__c: null,
      Scope_of_Work__c:
        "Synthetic rejected quote for workflow testing.",
      Homeowner_Summary__c:
        "Demonstration service quote."
    }
  ],

  products: [
    {
      Id: "01t000000000001",
      ProductCode: "SF-DEMO-SKU-001",
      Name: "Demonstration Solar Component",
      Description:
        "Synthetic product for Salesforce adapter testing.",
      UnitPrice__c: 450,
      Unit_Cost__c: 300,
      Active__c: true,
      Taxable__c: true,
      Category__c: "Materials"
    },
    {
      Id: "01t000000000002",
      ProductCode: "SF-DEMO-LABOR-001",
      Name: "Demonstration Field Labor",
      Description:
        "Synthetic labor product for adapter testing.",
      UnitPrice__c: 175,
      Unit_Cost__c: 0,
      Active__c: true,
      Taxable__c: false,
      Category__c: "Labor"
    }
  ],

  reviews: [
    {
      Id: "a10000000000001",
      Quote_ID__c: "a00000000000002",
      Review_Status__c: "completed",
      Decision__c: "approved",
      Comments__c:
        "Synthetic approval review.",
      CreatedDate: "2026-08-24T16:00:00.000Z",
      LastModifiedDate: "2026-08-24T16:00:00.000Z"
    }
  ],

  activities: [],
  followUps: [],

  users: [
    {
      Id: "005000000000001",
      Name: "Salesforce Demo Manager",
      Email: "demo.manager@example.invalid",
      User_Role__c: "admin",
      IsActive: true
    },
    {
      Id: "005000000000002",
      Name: "Salesforce Demo Coordinator",
      Email: "demo.coordinator@example.invalid",
      User_Role__c: "user",
      IsActive: true
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


# ==========================================
# SALESFORCE -> ENQUOTE FIELD MAPPING
# ==========================================

const quoteToDomain = (record) => ({
  id: record.Id,
  quote_number: record.Name,
  name: record.Name,
  site_id: record.Site_ID__c,
  case_number: record.Case_Number__c,
  status: record.Status__c,
  total: record.Total_Amount__c || 0,
  materials_total:
    record.Materials_Total__c || 0,
  labor_total:
    record.Labor_Total__c || 0,
  travel_total:
    record.Travel_Total__c || 0,
  sales_tax:
    record.Sales_Tax__c || 0,
  created_by:
    record.Created_By_Name__c,
  created_date:
    record.CreatedDate,
  updated_date:
    record.LastModifiedDate,
  is_current_version:
    record.Current_Version__c !== false,
  exclude_from_reporting:
    record.Exclude_From_Reporting__c === true,
  version_number:
    record.Version_Number__c || 1,
  parent_quote_id:
    record.Parent_Quote_ID__c || null,
  scope_of_work:
    record.Scope_of_Work__c || "",
  homeowner_summary:
    record.Homeowner_Summary__c || ""
});

const quoteToSalesforce = (record) => ({
  Id: record.id,
  Name:
    record.quote_number ||
    record.name ||
    `SF-DEMO-${Date.now()}`,
  Site_ID__c:
    record.site_id || "",
  Case_Number__c:
    record.case_number || "",
  Status__c:
    record.status || "draft_without_internal",
  Total_Amount__c:
    Number(record.total || 0),
  Materials_Total__c:
    Number(record.materials_total || 0),
  Labor_Total__c:
    Number(record.labor_total || 0),
  Travel_Total__c:
    Number(record.travel_total || 0),
  Sales_Tax__c:
    Number(record.sales_tax || 0),
  Created_By_Name__c:
    record.created_by || "Demo Coordinator",
  CreatedDate:
    record.created_date || now(),
  LastModifiedDate: now(),
  Current_Version__c:
    record.is_current_version !== false,
  Exclude_From_Reporting__c:
    record.exclude_from_reporting === true,
  Version_Number__c:
    record.version_number || 1,
  Parent_Quote_ID__c:
    record.parent_quote_id || null,
  Scope_of_Work__c:
    record.scope_of_work || "",
  Homeowner_Summary__c:
    record.homeowner_summary || ""
});

const productToDomain = (record) => ({
  id: record.Id,
  sku: record.ProductCode,
  product_code: record.ProductCode,
  name: record.Name,
  description: record.Description,
  price: record.UnitPrice__c || 0,
  unit_price: record.UnitPrice__c || 0,
  cost: record.Unit_Cost__c || 0,
  active: record.Active__c !== false,
  is_active: record.Active__c !== false,
  taxable: record.Taxable__c === true,
  category: record.Category__c || ""
});

const productToSalesforce = (record) => ({
  Id: record.id,
  ProductCode:
    record.sku ||
    record.product_code ||
    `SF-DEMO-SKU-${Date.now()}`,
  Name:
    record.name ||
    "Demonstration Product",
  Description:
    record.description || "",
  UnitPrice__c:
    Number(
      record.unit_price ??
      record.price ??
      0
    ),
  Unit_Cost__c:
    Number(record.cost || 0),
  Active__c:
    record.is_active ??
    record.active ??
    true,
  Taxable__c:
    record.taxable === true,
  Category__c:
    record.category || ""
});

const reviewToDomain = (record) => ({
  id: record.Id,
  quote_id: record.Quote_ID__c,
  review_status:
    record.Review_Status__c,
  decision:
    record.Decision__c,
  comments:
    record.Comments__c,
  created_date:
    record.CreatedDate,
  updated_date:
    record.LastModifiedDate
});

const userToDomain = (record) => ({
  id: record.Id,
  name: record.Name,
  full_name: record.Name,
  email: record.Email,
  role: record.User_Role__c,
  app_role: record.User_Role__c,
  active: record.IsActive !== false
});


# ==========================================
# INTERNAL HELPERS
# ==========================================

const findIndex = (collection, id) =>
  collection.findIndex(
    (record) => record.Id === id
  );

const filterDomainRecords = (
  records,
  filters = {}
) =>
  records.filter((record) =>
    Object.entries(filters).every(
      ([key, value]) =>
        record[key] === value
    )
  );

const localCollection = (name) => {
  if (!salesforceRecords[name]) {
    salesforceRecords[name] = [];
  }

  return salesforceRecords[name];
};


# ==========================================
# SALESFORCE MOCK ADAPTER
# ==========================================

export const salesforceMockAdapter = {
  getCurrentUser: async () =>
    clone(
      userToDomain(
        salesforceRecords.users[0]
      )
    ),

  getQuotes: async () =>
    clone(
      salesforceRecords.quotes.map(
        quoteToDomain
      )
    ),

  getQuoteById: async (quoteId) => {
    const record =
      salesforceRecords.quotes.find(
        (quote) => quote.Id === quoteId
      );

    return record
      ? clone(quoteToDomain(record))
      : null;
  },

  listRecentQuotes: async (
    limit = 100
  ) =>
    clone(
      salesforceRecords.quotes
        .map(quoteToDomain)
        .sort((a, b) =>
          String(b.created_date).localeCompare(
            String(a.created_date)
          )
        )
        .slice(0, limit)
    ),

  filterQuotes: async (
    filters = {}
  ) =>
    clone(
      filterDomainRecords(
        salesforceRecords.quotes.map(
          quoteToDomain
        ),
        filters
      )
    ),

  createQuote: async (data) => {
    const record =
      quoteToSalesforce(data);

    record.Id =
      data.id || createId("a00");

    salesforceRecords.quotes.push(
      record
    );

    return clone(
      quoteToDomain(record)
    );
  },

  updateQuote: async (
    quoteId,
    changes
  ) => {
    const index =
      findIndex(
        salesforceRecords.quotes,
        quoteId
      );

    if (index < 0) {
      throw new Error(
        `Salesforce mock quote not found: ${quoteId}`
      );
    }

    const current =
      quoteToDomain(
        salesforceRecords.quotes[index]
      );

    salesforceRecords.quotes[index] =
      quoteToSalesforce({
        ...current,
        ...changes,
        id: quoteId
      });

    return clone(
      quoteToDomain(
        salesforceRecords.quotes[index]
      )
    );
  },

  deleteQuote: async (quoteId) => {
    const index =
      findIndex(
        salesforceRecords.quotes,
        quoteId
      );

    if (index < 0) {
      return false;
    }

    salesforceRecords.quotes.splice(
      index,
      1
    );

    return true;
  },

  bulkUpdateQuotes: async (
    updates = []
  ) =>
    Promise.all(
      updates.map((update) =>
        salesforceMockAdapter.updateQuote(
          update.id,
          update.data || update
        )
      )
    ),

  getProducts: async () =>
    clone(
      salesforceRecords.products.map(
        productToDomain
      )
    ),

  listProducts: async () =>
    clone(
      salesforceRecords.products.map(
        productToDomain
      )
    ),

  filterProducts: async (
    filters = {}
  ) =>
    clone(
      filterDomainRecords(
        salesforceRecords.products.map(
          productToDomain
        ),
        filters
      )
    ),

  createProduct: async (data) => {
    const record =
      productToSalesforce(data);

    record.Id =
      data.id || createId("01t");

    salesforceRecords.products.push(
      record
    );

    return clone(
      productToDomain(record)
    );
  },

  updateProduct: async (
    productId,
    changes
  ) => {
    const index =
      findIndex(
        salesforceRecords.products,
        productId
      );

    if (index < 0) {
      throw new Error(
        `Salesforce mock product not found: ${productId}`
      );
    }

    const current =
      productToDomain(
        salesforceRecords.products[index]
      );

    salesforceRecords.products[index] =
      productToSalesforce({
        ...current,
        ...changes,
        id: productId
      });

    return clone(
      productToDomain(
        salesforceRecords.products[index]
      )
    );
  },

  deleteProduct: async (
    productId
  ) => {
    const index =
      findIndex(
        salesforceRecords.products,
        productId
      );

    if (index < 0) {
      return false;
    }

    salesforceRecords.products.splice(
      index,
      1
    );

    return true;
  },

  getReviews: async () =>
    clone(
      salesforceRecords.reviews.map(
        reviewToDomain
      )
    ),

  getReviewsForQuote: async (
    quoteId
  ) =>
    clone(
      salesforceRecords.reviews
        .map(reviewToDomain)
        .filter(
          (review) =>
            review.quote_id === quoteId
        )
    ),

  createReview: async (data) => {
    const record = {
      Id:
        data.id || createId("a10"),
      Quote_ID__c:
        data.quote_id,
      Review_Status__c:
        data.review_status ||
        "pending",
      Decision__c:
        data.decision || null,
      Comments__c:
        data.comments || "",
      CreatedDate:
        data.created_date || now(),
      LastModifiedDate: now()
    };

    salesforceRecords.reviews.push(
      record
    );

    return clone(
      reviewToDomain(record)
    );
  },

  updateReview: async (
    reviewId,
    changes
  ) => {
    const index =
      findIndex(
        salesforceRecords.reviews,
        reviewId
      );

    if (index < 0) {
      throw new Error(
        `Salesforce mock review not found: ${reviewId}`
      );
    }

    const current =
      reviewToDomain(
        salesforceRecords.reviews[index]
      );

    salesforceRecords.reviews[index] = {
      Id: reviewId,
      Quote_ID__c:
        changes.quote_id ??
        current.quote_id,
      Review_Status__c:
        changes.review_status ??
        current.review_status,
      Decision__c:
        changes.decision ??
        current.decision,
      Comments__c:
        changes.comments ??
        current.comments,
      CreatedDate:
        current.created_date,
      LastModifiedDate: now()
    };

    return clone(
      reviewToDomain(
        salesforceRecords.reviews[index]
      )
    );
  },

  getQuoteActivities: async (
    quoteId
  ) =>
    clone(
      salesforceRecords.activities.filter(
        (activity) =>
          activity.quote_id === quoteId
      )
    ),

  createQuoteActivity: async (
    data
  ) => {
    const record = {
      ...clone(data),
      id:
        data.id || createId("a20"),
      created_date:
        data.created_date || now()
    };

    salesforceRecords.activities.push(
      record
    );

    return clone(record);
  },

  getFollowUps: async (quoteId) =>
    clone(
      quoteId
        ? salesforceRecords.followUps.filter(
            (followUp) =>
              followUp.quote_id ===
              quoteId
          )
        : salesforceRecords.followUps
    ),

  createFollowUp: async (data) => {
    const record = {
      ...clone(data),
      id:
        data.id || createId("a30"),
      created_date:
        data.created_date || now()
    };

    salesforceRecords.followUps.push(
      record
    );

    return clone(record);
  },

  getUsers: async () =>
    clone(
      salesforceRecords.users.map(
        userToDomain
      )
    ),

  listLocalCollection: async (
    name
  ) =>
    clone(localCollection(name)),

  createLocalRecord: async (
    name,
    data
  ) => {
    const record = {
      ...clone(data),
      id:
        data.id || createId("a90"),
      created_date:
        data.created_date || now()
    };

    localCollection(name).push(
      record
    );

    return clone(record);
  },

  updateLocalRecord: async (
    name,
    recordId,
    changes
  ) => {
    const records =
      localCollection(name);

    const index =
      records.findIndex(
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
      updated_date: now()
    };

    return clone(records[index]);
  },

  deleteLocalRecord: async (
    name,
    recordId
  ) => {
    const records =
      localCollection(name);

    const index =
      records.findIndex(
        (record) =>
          record.id === recordId ||
          record.Id === recordId
      );

    if (index < 0) {
      return false;
    }

    records.splice(index, 1);
    return true;
  },

  exportLocalData: async () =>
    clone(salesforceRecords),

  importLocalData: async (data) => {
    Object.entries(data || {}).forEach(
      ([name, records]) => {
        salesforceRecords[name] =
          Array.isArray(records)
            ? clone(records)
            : [];
      }
    );

    return true;
  },

  resetLocalData: async () => {
    window.location.reload();
    return true;
  }
};
