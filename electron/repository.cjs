const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");

const DATA_VERSION = 1;
const fileName = "enquote-demo-data-v1.json";
const productSeed = [
  { id: "demo-product-001", name: "Disconnect Enclosure Repair", description: "Synthetic service item for demonstration quotes.", type: "service", sku: "DEMO-SVC-001", unit_price: 480, unit: "each", category: "Services", is_active: true },
  { id: "demo-product-002", name: "Outdoor Conduit Kit", description: "Synthetic conduit and fittings demonstration kit.", type: "product", sku: "DEMO-MAT-002", unit_price: 185, unit: "each", category: "Conduit & Raceway", is_active: true },
  { id: "demo-product-003", name: "Field Travel", description: "Synthetic service travel line item.", type: "service", sku: "DEMO-SVC-003", unit_price: 140, unit: "trip", category: "Services", is_active: true }
];
const quoteSchema = z.object({
  id: z.string().min(1),
  quote_number: z.string().optional(),
  status: z.string().optional(),
  total: z.number().optional(),
  is_current_version: z.boolean().optional(),
  parent_quote_id: z.string().nullable().optional(),
  version_number: z.number().optional()
}).passthrough();
const updateSchema = z.object({ id: z.string().min(1), changes: z.record(z.unknown()) });
const collectionNames = ["reviews", "activities", "followUps", "users", "siteFlags", "deletionRequests", "materialOrders", "rmas", "svCancels", "supportInteractions", "pdfTemplates", "priceReviews", "followUpConfigs", "pvManufacturers"];
const collectionDefaults = {
  reviews: [],
  activities: [],
  followUps: [],
  users: [{ id: "demo-user", email: "demo.manager@example.invalid", app_role: "admin", role: "admin", name: "Demo Manager" }]
};
collectionNames.forEach(name => { if (!collectionDefaults[name]) collectionDefaults[name] = []; });
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const seedQuotes = [
  { id: "demo-q-1001", quote_number: "DEMO-1001", site_id: "DEMO-SITE-01", case_number: "DEMO-CASE-01", status: "draft_without_internal", total: 1240, materials_total: 620, labor_total: 480, travel_total: 140, sales_tax: 0, created_by: "demo.coordinator.one", created_date: "2026-08-20T14:00:00.000Z", updated_date: "2026-08-20T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace damaged disconnect enclosure", homeowner_summary: "Repair solar equipment enclosure" },
  { id: "demo-q-1002", quote_number: "DEMO-1002", site_id: "DEMO-SITE-02", case_number: "DEMO-CASE-02", status: "submitted", total: 2160, materials_total: 910, labor_total: 980, travel_total: 270, sales_tax: 0, created_by: "demo.coordinator.two", created_date: "2026-08-18T14:00:00.000Z", updated_date: "2026-08-19T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace rooftop wiring and conduit", homeowner_summary: "Repair rooftop wiring" },
  { id: "demo-q-1003", quote_number: "DEMO-1003", site_id: "DEMO-SITE-03", case_number: "DEMO-CASE-03", status: "approved", total: 3480, materials_total: 1320, labor_total: 1740, travel_total: 420, sales_tax: 0, created_by: "demo.coordinator.three", created_date: "2026-08-12T14:00:00.000Z", updated_date: "2026-08-14T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace failed inverter components", homeowner_summary: "Replace inverter components" },
  { id: "demo-q-1004-v1", quote_number: "DEMO-1004", site_id: "DEMO-SITE-04", case_number: "DEMO-CASE-04", status: "rejected", total: 1920, materials_total: 700, labor_total: 980, travel_total: 240, sales_tax: 0, created_by: "demo.coordinator.one", created_date: "2026-08-05T14:00:00.000Z", updated_date: "2026-08-07T14:00:00.000Z", is_current_version: false, parent_quote_id: "demo-q-1004-v1", version_number: 1, scope_of_work: "Replace damaged combiner components", homeowner_summary: "Repair combiner" },
  { id: "demo-q-1004-v2", quote_number: "DEMO-1004", site_id: "DEMO-SITE-04", case_number: "DEMO-CASE-04", status: "quote_sent_to_ho", total: 1780, materials_total: 640, labor_total: 920, travel_total: 220, sales_tax: 0, created_by: "demo.coordinator.one", created_date: "2026-08-09T14:00:00.000Z", updated_date: "2026-08-11T14:00:00.000Z", is_current_version: true, parent_quote_id: "demo-q-1004-v1", version_number: 2, scope_of_work: "Replace damaged combiner components", homeowner_summary: "Repair combiner" },
  { id: "demo-q-1005", quote_number: "DEMO-1005", site_id: "DEMO-SITE-05", case_number: "DEMO-CASE-05", status: "invoice_paid", total: 2640, materials_total: 1060, labor_total: 1260, travel_total: 320, sales_tax: 0, created_by: "demo.coordinator.two", created_date: "2026-07-30T14:00:00.000Z", updated_date: "2026-08-03T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace service wiring", homeowner_summary: "Repair service wiring" },
  { id: "demo-q-1006", quote_number: "DEMO-1006", site_id: "DEMO-SITE-06", case_number: "DEMO-CASE-06", status: "scheduled", total: 3120, materials_total: 1240, labor_total: 1500, travel_total: 380, sales_tax: 0, created_by: "demo.coordinator.three", created_date: "2026-07-25T14:00:00.000Z", updated_date: "2026-08-01T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace damaged panel wiring", homeowner_summary: "Repair panel wiring" }
];

function repositoryFor(userDataPath) {
  const dataPath = path.join(userDataPath, fileName);

  async function read() {
    try {
      const parsed = JSON.parse(await fs.readFile(dataPath, "utf8"));
      if (parsed.version !== DATA_VERSION || !Array.isArray(parsed.quotes)) throw new Error("Incompatible local data file");
      parsed.products = parsed.products || structuredClone(productSeed);
      collectionNames.forEach(name => { parsed[name] = parsed[name] || structuredClone(collectionDefaults[name]); });
      return parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const initial = { version: DATA_VERSION, quotes: seedQuotes, products: productSeed };
      await write(initial);
      return initial;
    }
  }

  async function write(data) {
    await fs.mkdir(userDataPath, { recursive: true });
    const tempPath = `${dataPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tempPath, dataPath);
  }

  return {
    async list() { return (await read()).quotes; },
    async get(id) { return (await read()).quotes.find(quote => quote.id === id) || null; },
    async create(record) {
      const quote = quoteSchema.parse({ ...record, id: record.id || makeId("demo-quote") });
      const data = await read();
      if (data.quotes.some(item => item.id === quote.id)) throw new Error("A quote with this id already exists.");
      data.quotes.push(quote);
      await write(data);
      return quote;
    },
    async update(id, changes) {
      const data = await read();
      const index = data.quotes.findIndex(quote => quote.id === id);
      if (index < 0) throw new Error("Quote not found.");
      const quote = quoteSchema.parse({ ...data.quotes[index], ...z.record(z.unknown()).parse(changes), id });
      data.quotes[index] = quote;
      await write(data);
      return quote;
    },
    async remove(id) {
      const data = await read();
      const next = data.quotes.filter(quote => quote.id !== id);
      if (next.length === data.quotes.length) throw new Error("Quote not found.");
      data.quotes = next;
      await write(data);
      return { id };
    },
    async bulkUpdate(updates) {
      const parsed = z.array(updateSchema).parse(updates);
      const data = await read();
      for (const update of parsed) {
        const index = data.quotes.findIndex(quote => quote.id === update.id);
        if (index < 0) throw new Error(`Quote not found: ${update.id}`);
        data.quotes[index] = quoteSchema.parse({ ...data.quotes[index], ...update.changes, id: update.id });
      }
      await write(data);
      return data.quotes;
    },
    async reset() {
      const data = { version: DATA_VERSION, quotes: structuredClone(seedQuotes), products: structuredClone(productSeed) };
      collectionNames.forEach(name => { data[name] = structuredClone(collectionDefaults[name]); });
      await write(data);
      return data.quotes;
    },
    async exportData() { return read(); },
    async importData(input) {
      const parsed = z.object({ version: z.literal(DATA_VERSION), quotes: z.array(quoteSchema), products: z.array(z.record(z.unknown())).optional() }).parse(input);
      await write(parsed);
      return parsed.quotes;
    },
    async listProducts() { return (await read()).products || productSeed; },
    async createProduct(record) {
      const product = z.record(z.unknown()).parse({ ...record, id: record.id || makeId("demo-product") });
      const data = await read();
      data.products = data.products || productSeed;
      if (data.products.some(item => item.id === product.id)) throw new Error("A product with this id already exists.");
      data.products.push(product);
      await write(data);
      return product;
    },
    async updateProduct(id, changes) {
      const data = await read();
      data.products = data.products || productSeed;
      const index = data.products.findIndex(product => product.id === id);
      if (index < 0) throw new Error("Product not found.");
      data.products[index] = { ...data.products[index], ...z.record(z.unknown()).parse(changes), id };
      await write(data);
      return data.products[index];
    },
    async deleteProduct(id) {
      const data = await read();
      data.products = data.products || productSeed;
      const next = data.products.filter(product => product.id !== id);
      if (next.length === data.products.length) throw new Error("Product not found.");
      data.products = next;
      await write(data);
      return { id };
    },
    async listCollection(name) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      return data[name];
    },
    async createCollectionRecord(name, record) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      const item = { ...z.record(z.unknown()).parse(record), id: record.id || makeId(`demo-${name}`) };
      data[name].push(item);
      await write(data);
      return item;
    },
    async updateCollectionRecord(name, id, changes) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      const index = data[name].findIndex(item => item.id === id);
      if (index < 0) throw new Error(`${name} record not found.`);
      data[name][index] = { ...data[name][index], ...z.record(z.unknown()).parse(changes), id };
      await write(data);
      return data[name][index];
    },
    async deleteCollectionRecord(name, id) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      const next = data[name].filter(item => item.id !== id);
      if (next.length === data[name].length) throw new Error(`${name} record not found.`);
      data[name] = next;
      await write(data);
      return { id };
    }
  };
}

module.exports = { repositoryFor, fileName, DATA_VERSION };
