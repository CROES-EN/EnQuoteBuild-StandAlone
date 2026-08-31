const demoUser = {
  id: "demo-user",
  email: "demo.user@example.invalid",
  full_name: "Demo User",
  role: "admin"
};

const collections = {
  quotes: [],
  products: [],
  reviews: [],
  activities: [],
  followUps: [],
  users: [demoUser],
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

const clone = (value) => structuredClone(value);
const id = () => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function collection(name) {
  if (!collections[name]) collections[name] = [];
  return collections[name];
}

function create(name, data) {
  const record = {
    ...clone(data),
    id: data?.id || id(),
    created_date: data?.created_date || new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  collection(name).push(record);
  return clone(record);
}

function update(name, recordId, changes) {
  const records = collection(name);
  const index = records.findIndex((record) => record.id === recordId);
  if (index < 0) throw new Error(`Record not found: ${name}/${recordId}`);
  records[index] = {
    ...records[index],
    ...clone(changes),
    updated_date: new Date().toISOString()
  };
  return clone(records[index]);
}

function remove(name, recordId) {
  const records = collection(name);
  const index = records.findIndex((record) => record.id === recordId);
  if (index < 0) return false;
  records.splice(index, 1);
  return true;
}

function filter(name, filters = {}) {
  return clone(
    collection(name).filter((record) =>
      Object.entries(filters).every(([key, value]) => record[key] === value)
    )
  );
}

export const mockAdapter = {
  getCurrentUser: async () => clone(demoUser),

  getQuotes: async () => clone(collections.quotes),
  getQuoteById: async (quoteId) =>
    clone(collections.quotes.find((quote) => quote.id === quoteId) || null),
  listRecentQuotes: async (limit = 100) => clone(collections.quotes.slice(0, limit)),
  filterQuotes: async (filters = {}) => filter("quotes", filters),
  createQuote: async (data) => create("quotes", data),
  updateQuote: async (recordId, data) => update("quotes", recordId, data),
  deleteQuote: async (recordId) => remove("quotes", recordId),
  bulkUpdateQuotes: async (updates) =>
    updates.map(({ id: recordId, data, ...changes }) =>
      update("quotes", recordId, data || changes)
    ),

  getProducts: async () => clone(collections.products),
  listProducts: async () => clone(collections.products),
  filterProducts: async (filters = {}) => filter("products", filters),
  createProduct: async (data) => create("products", data),
  updateProduct: async (recordId, data) => update("products", recordId, data),
  deleteProduct: async (recordId) => remove("products", recordId),

  getReviews: async () => clone(collections.reviews),
  getReviewsForQuote: async (quoteId) => filter("reviews", { quote_id: quoteId }),
  createReview: async (data) => create("reviews", data),
  updateReview: async (recordId, data) => update("reviews", recordId, data),

  getQuoteActivities: async (quoteId) => filter("activities", { quote_id: quoteId }),
  createQuoteActivity: async (data) => create("activities", data),

  getFollowUps: async (quoteId) =>
    quoteId ? filter("followUps", { quote_id: quoteId }) : clone(collections.followUps),
  createFollowUp: async (data) => create("followUps", data),
  getUsers: async () => clone(collections.users),

  listLocalCollection: async (name) => clone(collection(name)),
  createLocalRecord: async (name, data) => create(name, data),
  updateLocalRecord: async (name, recordId, data) => update(name, recordId, data),
  deleteLocalRecord: async (name, recordId) => remove(name, recordId),
  exportLocalData: async () => clone(collections),
  importLocalData: async (data) => {
    Object.entries(data || {}).forEach(([name, records]) => {
      collections[name] = Array.isArray(records) ? clone(records) : [];
    });
    return true;
  },
  resetLocalData: async () => {
  Object.keys(collections).forEach(key => {
    if (Array.isArray(collections[key])) {
      collections[key] = [];
    }
  });

  collections.users = [demoUser];

  return true;
}
};