import { mockQuotes } from "../mockData/quotes";
import { mockProducts } from "../mockData/products";
import { base44 } from "./base44Client";

const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE || "base44";
const SUPPORTED_SOURCES = ["base44", "mock", "local", "salesforce"];
export const isLocalDataSource = ["mock", "local"].includes(DATA_SOURCE);
const mockStore = structuredClone(mockQuotes);
const mockProductStore = structuredClone(mockProducts);
const mockCollections = {
  reviews: [],
  activities: [],
  followUps: [],
  users: [{ id: "demo-user", email: "demo.manager@example.invalid", app_role: "admin", role: "admin", name: "Demo Manager" }]
};

if (!SUPPORTED_SOURCES.includes(DATA_SOURCE)) {
  throw new Error(`Unsupported VITE_DATA_SOURCE: ${DATA_SOURCE}. Use base44, mock, local, or salesforce.`);
}

function getLocalClient() {
  if (!window.enquoteLocal) {
    throw new Error("Local data source is unavailable outside the EnQuote Electron application.");
  }

  return window.enquoteLocal.quotes;
}

export async function getQuotes() {
  if (DATA_SOURCE === "mock") {
    return structuredClone(mockStore);
  }

  if (DATA_SOURCE === "local") {
    return getLocalClient().list();
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  const response = await base44.functions.invoke("getAllQuotes");

  return response?.data || [];
}

export async function getQuoteById(quoteId) {
  if (DATA_SOURCE === "mock") {
    const quotes = await getQuotes();
    return quotes.find(quote => quote.id === quoteId) || null;
  }

  if (DATA_SOURCE === "local") {
    return getLocalClient().get(quoteId);
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  const response = await base44.functions.invoke("getQuoteById", {
    quote_id: quoteId
  });

  return response?.data?.quote || null;
}

export async function listRecentQuotes(limit = 100) {
  if (DATA_SOURCE === "mock") {
    const quotes = await getQuotes();

    return quotes
      .sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")))
      .slice(0, limit);
  }

  if (DATA_SOURCE === "local") {
    return (await getLocalClient().list()).sort((a, b) =>
      String(b.created_date || "").localeCompare(String(a.created_date || ""))
    ).slice(0, limit);
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  return base44.entities.Quote.list(
    "-created_date",
    limit
  );
}

export async function filterQuotes(filters = {}) {
  if (DATA_SOURCE === "mock") {
    const quotes = await getQuotes();

    return quotes.filter(quote =>
      Object.entries(filters).every(([field, value]) => quote[field] === value)
    );
  }

  if (DATA_SOURCE === "local") {
    return (await getLocalClient().list()).filter(quote =>
      Object.entries(filters).every(([field, value]) => quote[field] === value)
    );
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  return base44.entities.Quote.filter(filters);
}

export async function createQuote(data) {
  if (DATA_SOURCE === "mock") {
    const quote = { ...data, id: data.id || `demo-${Date.now()}` };
    mockStore.push(quote);
    return structuredClone(quote);
  }

  if (DATA_SOURCE === "local") {
    return getLocalClient().create(data);
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  return base44.entities.Quote.create(data);
}

export async function updateQuote(id, data) {
  if (DATA_SOURCE === "mock") {
    const index = mockStore.findIndex(quote => quote.id === id);
    if (index < 0) throw new Error("Quote not found.");
    mockStore[index] = { ...mockStore[index], ...data, id };
    return structuredClone(mockStore[index]);
  }

  if (DATA_SOURCE === "local") {
    return getLocalClient().update(id, data);
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  return base44.entities.Quote.update(id, data);
}

export async function deleteQuote(id) {
  if (DATA_SOURCE === "mock") {
    const index = mockStore.findIndex(quote => quote.id === id);
    if (index < 0) throw new Error("Quote not found.");
    mockStore.splice(index, 1);
    return { id };
  }

  if (DATA_SOURCE === "local") {
    return getLocalClient().delete(id);
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  return base44.entities.Quote.delete(id);
}

export async function bulkUpdateQuotes(updates) {
  if (DATA_SOURCE === "mock") {
    updates.forEach(({ id, ...changes }) => {
      const index = mockStore.findIndex(quote => quote.id === id);
      if (index < 0) throw new Error(`Quote not found: ${id}`);
      mockStore[index] = { ...mockStore[index], ...changes, id };
    });
    return structuredClone(mockStore);
  }

  if (DATA_SOURCE === "local") {
    return getLocalClient().bulkUpdate(updates);
  }

  if (DATA_SOURCE === "salesforce") {
    throw new Error("Salesforce integration is not configured.");
  }

  return base44.entities.Quote.bulkUpdate(updates);
}

export async function getCurrentUser() {
  if (isLocalDataSource) {
    return { id: "demo-user", email: "demo.manager@example.invalid", app_role: "admin", role: "admin" };
  }

  return base44.auth.me();
}

function getLocalProductsClient() {
  if (!window.enquoteLocal?.products) {
    throw new Error("Local product repository is unavailable outside the EnQuote Electron application.");
  }

  return window.enquoteLocal.products;
}

export async function getProducts() {
  if (DATA_SOURCE === "mock") return structuredClone(mockProductStore);
  if (DATA_SOURCE === "local") return getLocalProductsClient().list();
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  const response = await base44.functions.invoke("getAllProducts", {});
  return response?.data?.products || [];
}

export async function createProduct(data) {
  if (DATA_SOURCE === "mock") {
    const product = { ...data, id: data.id || `demo-product-${Date.now()}` };
    mockProductStore.push(product);
    return structuredClone(product);
  }
  if (DATA_SOURCE === "local") return getLocalProductsClient().create(data);
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  return base44.entities.Product.create(data);
}

export async function updateProduct(id, data) {
  if (DATA_SOURCE === "mock") {
    const index = mockProductStore.findIndex(product => product.id === id);
    if (index < 0) throw new Error("Product not found.");
    mockProductStore[index] = { ...mockProductStore[index], ...data, id };
    return structuredClone(mockProductStore[index]);
  }
  if (DATA_SOURCE === "local") return getLocalProductsClient().update(id, data);
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  return base44.entities.Product.update(id, data);
}

export async function deleteProduct(id) {
  if (DATA_SOURCE === "mock") {
    const index = mockProductStore.findIndex(product => product.id === id);
    if (index < 0) throw new Error("Product not found.");
    mockProductStore.splice(index, 1);
    return { id };
  }
  if (DATA_SOURCE === "local") return getLocalProductsClient().delete(id);
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  return base44.entities.Product.delete(id);
}

function getLocalCollectionClient() {
  if (!window.enquoteLocal?.collections) {
    throw new Error("Local collection repository is unavailable outside the EnQuote Electron application.");
  }
  return window.enquoteLocal.collections;
}

async function listCollection(name) {
  if (DATA_SOURCE === "mock") return structuredClone(mockCollections[name] || []);
  if (DATA_SOURCE === "local") return getLocalCollectionClient().list(name);
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  const entity = { reviews: "QuoteReview", activities: "QuoteActivity", followUps: "FollowUpLog", users: "User", siteFlags: "SiteFlag", deletionRequests: "QuoteDeletionRequest", materialOrders: "MaterialOrder", rmas: "PVPanelRMA", svCancels: "SVCancelTracker", supportInteractions: "SupportInteraction", pdfTemplates: "PDFTemplate", priceReviews: "PriceReview", followUpConfigs: "FollowUpConfig", pvManufacturers: "PVManufacturer" }[name];
  return entity ? base44.entities[entity].list("-created_date", 500) : [];
}

async function createCollectionRecord(name, record) {
  if (DATA_SOURCE === "mock") {
    const item = { ...record, id: record.id || `demo-${name}-${Date.now()}` };
    (mockCollections[name] || (mockCollections[name] = [])).push(item);
    return structuredClone(item);
  }
  if (DATA_SOURCE === "local") return getLocalCollectionClient().create(name, record);
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  const entity = { reviews: "QuoteReview", activities: "QuoteActivity", followUps: "FollowUpLog", users: "User", siteFlags: "SiteFlag", deletionRequests: "QuoteDeletionRequest", materialOrders: "MaterialOrder", rmas: "PVPanelRMA", svCancels: "SVCancelTracker", supportInteractions: "SupportInteraction", pdfTemplates: "PDFTemplate", priceReviews: "PriceReview", followUpConfigs: "FollowUpConfig", pvManufacturers: "PVManufacturer" }[name];
  return base44.entities[entity].create(record);
}

async function updateCollectionRecord(name, id, changes) {
  if (DATA_SOURCE === "mock") {
    const item = (mockCollections[name] || []).find(record => record.id === id);
    if (!item) throw new Error(`${name} record not found.`);
    Object.assign(item, changes);
    return structuredClone(item);
  }
  if (DATA_SOURCE === "local") return getLocalCollectionClient().update(name, id, changes);
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  const entity = { reviews: "QuoteReview", activities: "QuoteActivity", followUps: "FollowUpLog", users: "User", pvManufacturers: "PVManufacturer" }[name];
  return base44.entities[entity].update(id, changes);
}

async function deleteCollectionRecord(name, id) {
  if (DATA_SOURCE === "mock") {
    const records = mockCollections[name] || [];
    const index = records.findIndex(record => record.id === id);
    if (index < 0) throw new Error(`${name} record not found.`);
    records.splice(index, 1);
    return { id };
  }
  if (DATA_SOURCE === "local") return getLocalCollectionClient().delete(name, id);
  if (DATA_SOURCE === "salesforce") throw new Error("Salesforce integration is not configured.");
  const entity = { reviews: "QuoteReview", activities: "QuoteActivity", followUps: "FollowUpLog", users: "User", siteFlags: "SiteFlag", deletionRequests: "QuoteDeletionRequest", materialOrders: "MaterialOrder", rmas: "PVPanelRMA", svCancels: "SVCancelTracker", supportInteractions: "SupportInteraction", pdfTemplates: "PDFTemplate", priceReviews: "PriceReview", followUpConfigs: "FollowUpConfig", pvManufacturers: "PVManufacturer" }[name];
  return base44.entities[entity].delete(id);
}

export async function getReviews(quoteId) {
  const reviews = await listCollection("reviews");
  return quoteId ? reviews.filter(review => review.quote_id === quoteId) : reviews;
}

export async function createReview(data) { return createCollectionRecord("reviews", data); }
export async function updateReview(id, data) { return updateCollectionRecord("reviews", id, data); }
export async function getQuoteActivities(quoteId) {
  const activities = await listCollection("activities");
  return activities.filter(activity => activity.quote_id === quoteId);
}
export async function createQuoteActivity(data) { return createCollectionRecord("activities", data); }
export async function getFollowUps(quoteId) {
  const followUps = await listCollection("followUps");
  return quoteId ? followUps.filter(item => item.quote_id === quoteId) : followUps;
}
export async function createFollowUp(data) { return createCollectionRecord("followUps", data); }
export async function updateFollowUp(id, data) { return updateCollectionRecord("followUps", id, data); }
export async function getUsers() { return listCollection("users"); }
export async function listLocalCollection(name) { return listCollection(name); }
export async function createLocalRecord(name, data) { return createCollectionRecord(name, data); }
export async function updateLocalRecord(name, id, data) { return updateCollectionRecord(name, id, data); }
export async function deleteLocalRecord(name, id) { return deleteCollectionRecord(name, id); }

export async function resetLocalData() {
  if (DATA_SOURCE !== "local") throw new Error("Local data reset is only available in local mode.");
  return getLocalClient().reset();
}

export async function exportLocalData() {
  if (DATA_SOURCE !== "local") throw new Error("Local data export is only available in local mode.");
  return getLocalClient().exportData();
}

export async function importLocalData(data) {
  if (DATA_SOURCE !== "local") throw new Error("Local data import is only available in local mode.");
  return getLocalClient().importData(data);
}