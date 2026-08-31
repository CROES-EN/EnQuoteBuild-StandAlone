param(
    [string]$ProjectPath = ".",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$project = (Resolve-Path $ProjectPath).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $project "adapter-repair-backup-$stamp"
$adaptersDir = Join-Path $project "src\api\adapters"
$dataClientPath = Join-Path $project "src\api\dataClient.js"
$envPath = Join-Path $project ".env.local"
$buildLog = Join-Path $project "adapter-repair-build.log"

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
New-Item -ItemType Directory -Path $adaptersDir -Force | Out-Null

function Backup-File([string]$Path) {
    if (Test-Path $Path) {
        $relative = $Path.Substring($project.Length).TrimStart('\')
        $target = Join-Path $backupDir $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item $Path $target -Force
    }
}

$filesToBackup = @(
    $dataClientPath,
    (Join-Path $adaptersDir "base44Adapter.js"),
    (Join-Path $adaptersDir "mockAdapter.js"),
    (Join-Path $adaptersDir "localAdapter.js"),
    (Join-Path $adaptersDir "salesforceAdapter.js"),
    $envPath
)
$filesToBackup | ForEach-Object { Backup-File $_ }

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

# Keep the currently working backend active while preserving adapter readiness.
Write-Utf8NoBom $envPath "VITE_DATA_SOURCE=base44`r`n"

$base44Adapter = @'
import { base44 } from "../base44Client";

const ENTITY_ALIASES = {
  quotes: "Quote",
  quote: "Quote",
  products: "Product",
  product: "Product",
  reviews: "QuoteReview",
  quoteReviews: "QuoteReview",
  activities: "QuoteActivity",
  quoteActivities: "QuoteActivity",
  followUps: "FollowUpLog",
  followUpLogs: "FollowUpLog",
  users: "User",
  siteFlags: "SiteFlag",
  quoteDeletionRequests: "QuoteDeletionRequest",
  materialOrders: "MaterialOrder",
  pvPanelRMAs: "PVPanelRMA",
  pdfTemplates: "PDFTemplate",
  emailDistributions: "EmailDistribution",
  statusAlertDismissals: "StatusAlertDismissal",
  priceReviews: "PriceReview",
  svcCancelTracker: "SVCancelTracker"
};

function resolveEntity(collectionName) {
  const name = ENTITY_ALIASES[collectionName] || collectionName;
  const entity = base44.entities?.[name];

  if (!entity) {
    throw new Error(`Base44 entity is not configured for collection: ${collectionName}`);
  }

  return entity;
}

export const base44Adapter = {
  getCurrentUser: () => base44.auth.me(),

  getQuotes: async () => {
    const response = await base44.functions.invoke("getAllQuotes");
    return response?.data || [];
  },

  getQuoteById: async (quoteId) => {
    const response = await base44.functions.invoke("getQuoteById", {
      quote_id: quoteId
    });
    return response?.data?.quote || response?.data || null;
  },

  listRecentQuotes: (limit = 100) =>
    base44.entities.Quote.list("-created_date", limit),

  filterQuotes: (filters = {}) =>
    base44.entities.Quote.filter(filters),

  createQuote: (data) => base44.entities.Quote.create(data),
  updateQuote: (id, data) => base44.entities.Quote.update(id, data),
  deleteQuote: (id) => base44.entities.Quote.delete(id),
  bulkUpdateQuotes: (updates) => base44.entities.Quote.bulkUpdate(updates),

  getProducts: async () => {
    const response = await base44.functions.invoke("getAllProducts");
    return response?.data || [];
  },

  listProducts: (sort = "name", limit = 2000) =>
    base44.entities.Product.list(sort, limit),

  filterProducts: (filters = {}) =>
    base44.entities.Product.filter(filters),

  createProduct: (data) => base44.entities.Product.create(data),
  updateProduct: (id, data) => base44.entities.Product.update(id, data),
  deleteProduct: (id) => base44.entities.Product.delete(id),

  getReviews: (sort = "-created_date", limit = 2000) =>
    base44.entities.QuoteReview.list(sort, limit),

  getReviewsForQuote: (quoteId) =>
    base44.entities.QuoteReview.filter({ quote_id: quoteId }),

  createReview: (data) => base44.entities.QuoteReview.create(data),
  updateReview: (id, data) => base44.entities.QuoteReview.update(id, data),

  getQuoteActivities: (quoteId) =>
    base44.entities.QuoteActivity.filter(
      { quote_id: quoteId },
      "-action_at",
      100
    ),

  createQuoteActivity: (data) =>
    base44.entities.QuoteActivity.create(data),

  getFollowUps: (quoteId) =>
    quoteId
      ? base44.entities.FollowUpLog.filter(
          { quote_id: quoteId },
          "-created_date",
          200
        )
      : base44.entities.FollowUpLog.list("-created_date", 200),

  createFollowUp: (data) => base44.entities.FollowUpLog.create(data),

  getUsers: async () => {
    const response = await base44.functions.invoke("getAllUsers");
    return response?.data || [];
  },

  listLocalCollection: (collectionName, sort = "-created_date", limit = 2000) =>
    resolveEntity(collectionName).list(sort, limit),

  createLocalRecord: (collectionName, data) =>
    resolveEntity(collectionName).create(data),

  updateLocalRecord: (collectionName, id, data) =>
    resolveEntity(collectionName).update(id, data),

  deleteLocalRecord: (collectionName, id) =>
    resolveEntity(collectionName).delete(id),

  exportLocalData: async () => {
    throw new Error("Local data export is only available when VITE_DATA_SOURCE=local.");
  },

  importLocalData: async () => {
    throw new Error("Local data import is only available when VITE_DATA_SOURCE=local.");
  }
};
'@

$mockAdapter = @'
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
  }
};
'@

$localAdapter = @'
function bridge() {
  if (!globalThis.window?.enquoteLocal) {
    throw new Error("Local Electron persistence is unavailable in this runtime.");
  }
  return globalThis.window.enquoteLocal;
}

function resource(name) {
  const api = bridge()[name];
  if (!api) throw new Error(`Local bridge resource is unavailable: ${name}`);
  return api;
}

export const localAdapter = {
  getCurrentUser: () =>
    bridge().auth?.getCurrentUser?.() ||
    Promise.resolve({
      id: "demo-user",
      email: "demo.user@example.invalid",
      full_name: "Demo User",
      role: "admin"
    }),

  getQuotes: () => resource("quotes").list(),
  getQuoteById: (quoteId) => resource("quotes").get(quoteId),
  listRecentQuotes: (limit = 100) => resource("quotes").list({ limit }),
  filterQuotes: (filters = {}) => resource("quotes").filter(filters),
  createQuote: (data) => resource("quotes").create(data),
  updateQuote: (recordId, data) => resource("quotes").update(recordId, data),
  deleteQuote: (recordId) => resource("quotes").delete(recordId),
  bulkUpdateQuotes: (updates) => resource("quotes").bulkUpdate(updates),

  getProducts: () => resource("products").list(),
  listProducts: () => resource("products").list(),
  filterProducts: (filters = {}) => resource("products").filter(filters),
  createProduct: (data) => resource("products").create(data),
  updateProduct: (recordId, data) => resource("products").update(recordId, data),
  deleteProduct: (recordId) => resource("products").delete(recordId),

  getReviews: () => resource("reviews").list(),
  getReviewsForQuote: (quoteId) => resource("reviews").filter({ quote_id: quoteId }),
  createReview: (data) => resource("reviews").create(data),
  updateReview: (recordId, data) => resource("reviews").update(recordId, data),

  getQuoteActivities: (quoteId) =>
    resource("activities").filter({ quote_id: quoteId }),
  createQuoteActivity: (data) => resource("activities").create(data),

  getFollowUps: (quoteId) =>
    quoteId
      ? resource("followUps").filter({ quote_id: quoteId })
      : resource("followUps").list(),
  createFollowUp: (data) => resource("followUps").create(data),
  getUsers: () => resource("users").list(),

  listLocalCollection: (name, ...args) => bridge().collections.list(name, ...args),
  createLocalRecord: (name, data) => bridge().collections.create(name, data),
  updateLocalRecord: (name, recordId, data) =>
    bridge().collections.update(name, recordId, data),
  deleteLocalRecord: (name, recordId) =>
    bridge().collections.delete(name, recordId),
  exportLocalData: () => bridge().data.export(),
  importLocalData: (data) => bridge().data.import(data)
};
'@

$salesforceAdapter = @'
const deferred = (methodName) => {
  throw new Error(
    `${methodName} is unavailable because Salesforce integration is deferred pending SFDC admin approval, sandbox access, OAuth PKCE configuration, API permissions, object mappings, and security review.`
  );
};

const methodNames = [
  "getCurrentUser",
  "getQuotes",
  "getQuoteById",
  "listRecentQuotes",
  "filterQuotes",
  "createQuote",
  "updateQuote",
  "deleteQuote",
  "bulkUpdateQuotes",
  "getProducts",
  "listProducts",
  "filterProducts",
  "createProduct",
  "updateProduct",
  "deleteProduct",
  "getReviews",
  "getReviewsForQuote",
  "createReview",
  "updateReview",
  "getQuoteActivities",
  "createQuoteActivity",
  "getFollowUps",
  "createFollowUp",
  "getUsers",
  "listLocalCollection",
  "createLocalRecord",
  "updateLocalRecord",
  "deleteLocalRecord",
  "exportLocalData",
  "importLocalData"
];

export const salesforceAdapter = Object.fromEntries(
  methodNames.map((methodName) => [methodName, () => deferred(methodName)])
);
'@

$dataClient = @'
import { base44Adapter } from "./adapters/base44Adapter";
import { mockAdapter } from "./adapters/mockAdapter";
import { localAdapter } from "./adapters/localAdapter";
import { salesforceAdapter } from "./adapters/salesforceAdapter";

const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE || "base44";
const adapters = {
  base44: base44Adapter,
  mock: mockAdapter,
  local: localAdapter,
  salesforce: salesforceAdapter
};

const adapter = adapters[DATA_SOURCE];
if (!adapter) throw new Error(`Unsupported VITE_DATA_SOURCE: ${DATA_SOURCE}`);

function call(methodName, args) {
  const method = adapter[methodName];
  if (typeof method !== "function") {
    throw new Error(`${methodName} is not implemented by the ${DATA_SOURCE} adapter.`);
  }
  return method(...args);
}

export const getDataSource = () => DATA_SOURCE;
export const isBase44DataSource = DATA_SOURCE === "base44";
export const isMockDataSource = DATA_SOURCE === "mock";
export const isLocalDataSource = DATA_SOURCE === "local";
export const isSalesforceDataSource = DATA_SOURCE === "salesforce";

export const getCurrentUser = (...args) => call("getCurrentUser", args);
export const getQuotes = (...args) => call("getQuotes", args);
export const getQuoteById = (...args) => call("getQuoteById", args);
export const listRecentQuotes = (...args) => call("listRecentQuotes", args);
export const filterQuotes = (...args) => call("filterQuotes", args);
export const createQuote = (...args) => call("createQuote", args);
export const updateQuote = (...args) => call("updateQuote", args);
export const deleteQuote = (...args) => call("deleteQuote", args);
export const bulkUpdateQuotes = (...args) => call("bulkUpdateQuotes", args);

export const getProducts = (...args) => call("getProducts", args);
export const listProducts = (...args) => call("listProducts", args);
export const filterProducts = (...args) => call("filterProducts", args);
export const createProduct = (...args) => call("createProduct", args);
export const updateProduct = (...args) => call("updateProduct", args);
export const deleteProduct = (...args) => call("deleteProduct", args);

export const getReviews = (...args) => call("getReviews", args);
export const getReviewsForQuote = (...args) => call("getReviewsForQuote", args);
export const createReview = (...args) => call("createReview", args);
export const updateReview = (...args) => call("updateReview", args);

export const getQuoteActivities = (...args) => call("getQuoteActivities", args);
export const createQuoteActivity = (...args) => call("createQuoteActivity", args);
export const getFollowUps = (...args) => call("getFollowUps", args);
export const createFollowUp = (...args) => call("createFollowUp", args);
export const getUsers = (...args) => call("getUsers", args);

export const listLocalCollection = (...args) => call("listLocalCollection", args);
export const createLocalRecord = (...args) => call("createLocalRecord", args);
export const updateLocalRecord = (...args) => call("updateLocalRecord", args);
export const deleteLocalRecord = (...args) => call("deleteLocalRecord", args);
export const exportLocalData = (...args) => call("exportLocalData", args);
export const importLocalData = (...args) => call("importLocalData", args);
'@

Write-Utf8NoBom (Join-Path $adaptersDir "base44Adapter.js") $base44Adapter
Write-Utf8NoBom (Join-Path $adaptersDir "mockAdapter.js") $mockAdapter
Write-Utf8NoBom (Join-Path $adaptersDir "localAdapter.js") $localAdapter
Write-Utf8NoBom (Join-Path $adaptersDir "salesforceAdapter.js") $salesforceAdapter
Write-Utf8NoBom $dataClientPath $dataClient

# Syntax-check every rewritten JavaScript module before attempting the Vite build.
$nodeCmd = Get-Command node -ErrorAction Stop
$rewrittenFiles = @(
  (Join-Path $adaptersDir "base44Adapter.js"),
  (Join-Path $adaptersDir "mockAdapter.js"),
  (Join-Path $adaptersDir "localAdapter.js"),
  (Join-Path $adaptersDir "salesforceAdapter.js"),
  $dataClientPath
)

foreach ($file in $rewrittenFiles) {
    & $nodeCmd.Source --check $file
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript syntax validation failed: $file"
    }
}

Write-Host "Adapter files were replaced and passed Node syntax validation." -ForegroundColor Green
Write-Host "Backup directory: $backupDir" -ForegroundColor Cyan

if (-not $SkipBuild) {
    Push-Location $project
    try {
        & npm.cmd run build 2>&1 | Tee-Object -FilePath $buildLog
        $buildExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($buildExit -ne 0) {
        Write-Host "The adapter syntax is fixed, but another project build issue remains." -ForegroundColor Yellow
        Write-Host "Build log: $buildLog" -ForegroundColor Yellow
        Write-Host "Backup directory: $backupDir" -ForegroundColor Yellow
        exit $buildExit
    }

    Write-Host "SUCCESS: npm run build completed." -ForegroundColor Green
}

Write-Host "Active data source remains Base44 via .env.local." -ForegroundColor Green
Write-Host "Salesforce remains a non-connecting placeholder." -ForegroundColor Green
