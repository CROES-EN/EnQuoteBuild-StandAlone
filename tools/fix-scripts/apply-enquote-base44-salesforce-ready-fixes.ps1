param(
    [string]$ProjectPath = "."
)

$ErrorActionPreference = "Stop"
$project = (Resolve-Path $ProjectPath).Path
$packagePath = Join-Path $project "package.json"
$envPath = Join-Path $project ".env.local"
$adaptersPath = Join-Path $project "src\api\adapters"
$dataClientPath = Join-Path $project "src\api\dataClient.js"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $project "pre-salesforce-fix-backup-$stamp"

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

function Backup-IfExists([string]$path) {
    if (Test-Path $path) {
        $name = Split-Path $path -Leaf
        Copy-Item $path (Join-Path $backupDir $name) -Force
    }
}

Backup-IfExists $packagePath
Backup-IfExists $envPath
Backup-IfExists $dataClientPath

if (-not (Test-Path $packagePath)) {
    throw "package.json not found at $packagePath"
}

# 1) Keep Base44 as the active data source for current operations.
[System.IO.File]::WriteAllText($envPath, "VITE_DATA_SOURCE=base44`r`n", [System.Text.UTF8Encoding]::new($false))

# 2) Add safe application metadata and predictable build artifact naming.
$pkg = Get-Content $packagePath -Raw | ConvertFrom-Json
$pkg | Add-Member -NotePropertyName description -NotePropertyValue "EnQuote desktop application for solar O&M quote workflows" -Force
$pkg | Add-Member -NotePropertyName author -NotePropertyValue "Enphase Energy" -Force
if (-not $pkg.version -or $pkg.version -eq "0.0.0") { $pkg.version = "0.1.0" }
if (-not $pkg.build) { $pkg | Add-Member -NotePropertyName build -NotePropertyValue ([pscustomobject]@{}) -Force }
$pkg.build | Add-Member -NotePropertyName artifactName -NotePropertyValue 'EnQuote-Setup-${version}.${ext}' -Force
if (-not $pkg.build.win) { $pkg.build | Add-Member -NotePropertyName win -NotePropertyValue ([pscustomobject]@{}) -Force }
$iconPath = Join-Path $project "build\icon.ico"
if (Test-Path $iconPath) {
    $pkg.build.win | Add-Member -NotePropertyName icon -NotePropertyValue "build/icon.ico" -Force
}
$json = $pkg | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($packagePath, $json, [System.Text.UTF8Encoding]::new($false))
Get-Content $packagePath -Raw | ConvertFrom-Json | Out-Null

# 3) Create adapter boundaries. Base44 stays operational; Salesforce is a placeholder only.
New-Item -ItemType Directory -Path $adaptersPath -Force | Out-Null

$base44Adapter = @'
import { base44 } from "../base44Client";

export const base44Adapter = {
  getCurrentUser: () => base44.auth.me(),
  getQuotes: async () => {
    const response = await base44.functions.invoke("getAllQuotes");
    return response?.data || [];
  },
  getQuoteById: async (quoteId) => {
    const response = await base44.functions.invoke("getQuoteById", { quote_id: quoteId });
    return response?.data?.quote || null;
  },
  listRecentQuotes: (limit = 100) => base44.entities.Quote.list("-created_date", limit),
  filterQuotes: (filters = {}) => base44.entities.Quote.filter(filters),
  createQuote: (data) => base44.entities.Quote.create(data),
  updateQuote: (id, data) => base44.entities.Quote.update(id, data),
  deleteQuote: (id) => base44.entities.Quote.delete(id),
  bulkUpdateQuotes: (updates) => base44.entities.Quote.bulkUpdate(updates),
};
'@
[System.IO.File]::WriteAllText((Join-Path $adaptersPath "base44Adapter.js"), $base44Adapter, [System.Text.UTF8Encoding]::new($false))

$salesforceAdapter = @'
const notConfigured = () => {
  throw new Error(
    "Salesforce integration is deferred pending SFDC admin approval, sandbox access, OAuth PKCE configuration, API permissions, object mappings, and security review."
  );
};

export const salesforceAdapter = {
  getCurrentUser: notConfigured,
  getQuotes: notConfigured,
  getQuoteById: notConfigured,
  listRecentQuotes: notConfigured,
  filterQuotes: notConfigured,
  createQuote: notConfigured,
  updateQuote: notConfigured,
  deleteQuote: notConfigured,
  bulkUpdateQuotes: notConfigured,
};
'@
[System.IO.File]::WriteAllText((Join-Path $adaptersPath "salesforceAdapter.js"), $salesforceAdapter, [System.Text.UTF8Encoding]::new($false))

# Preserve existing mock/local implementations when present. Otherwise add safe placeholders.
$mockPath = Join-Path $adaptersPath "mockAdapter.js"
if (-not (Test-Path $mockPath)) {
$mockAdapter = @'
import { mockQuotes } from "../../mockData/quotes";

const copy = (value) => structuredClone(value);

export const mockAdapter = {
  getCurrentUser: async () => ({ id: "demo-user", email: "demo.user@example.invalid", role: "admin", full_name: "Demo User" }),
  getQuotes: async () => copy(mockQuotes),
  getQuoteById: async (quoteId) => copy(mockQuotes.find((quote) => quote.id === quoteId) || null),
  listRecentQuotes: async (limit = 100) => copy(mockQuotes.slice(0, limit)),
  filterQuotes: async (filters = {}) => copy(mockQuotes.filter((quote) => Object.entries(filters).every(([key, value]) => quote[key] === value))),
  createQuote: async () => { throw new Error("Mock writes require the local persistence adapter."); },
  updateQuote: async () => { throw new Error("Mock writes require the local persistence adapter."); },
  deleteQuote: async () => { throw new Error("Mock writes require the local persistence adapter."); },
  bulkUpdateQuotes: async () => { throw new Error("Mock writes require the local persistence adapter."); },
};
'@
[System.IO.File]::WriteAllText($mockPath, $mockAdapter, [System.Text.UTF8Encoding]::new($false))
}

$localPath = Join-Path $adaptersPath "localAdapter.js"
if (-not (Test-Path $localPath)) {
$localAdapter = @'
const requireLocalBridge = () => {
  if (!window.enquoteLocal?.quotes) {
    throw new Error("Local Electron persistence is not available in this runtime.");
  }
  return window.enquoteLocal;
};

export const localAdapter = {
  getCurrentUser: async () => ({ id: "demo-user", email: "demo.user@example.invalid", role: "admin", full_name: "Demo User" }),
  getQuotes: () => requireLocalBridge().quotes.list(),
  getQuoteById: (quoteId) => requireLocalBridge().quotes.get(quoteId),
  listRecentQuotes: (limit = 100) => requireLocalBridge().quotes.list({ limit }),
  filterQuotes: (filters = {}) => requireLocalBridge().quotes.filter(filters),
  createQuote: (data) => requireLocalBridge().quotes.create(data),
  updateQuote: (id, data) => requireLocalBridge().quotes.update(id, data),
  deleteQuote: (id) => requireLocalBridge().quotes.delete(id),
  bulkUpdateQuotes: (updates) => requireLocalBridge().quotes.bulkUpdate(updates),
};
'@
[System.IO.File]::WriteAllText($localPath, $localAdapter, [System.Text.UTF8Encoding]::new($false))
}

# 4) Replace dataClient with a selector that keeps Base44 active today and Salesforce ready later.
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
  salesforce: salesforceAdapter,
};

const adapter = adapters[DATA_SOURCE];

if (!adapter) {
  throw new Error(`Unsupported VITE_DATA_SOURCE: ${DATA_SOURCE}`);
}

export const getDataSource = () => DATA_SOURCE;
export const getCurrentUser = (...args) => adapter.getCurrentUser(...args);
export const getQuotes = (...args) => adapter.getQuotes(...args);
export const getQuoteById = (...args) => adapter.getQuoteById(...args);
export const listRecentQuotes = (...args) => adapter.listRecentQuotes(...args);
export const filterQuotes = (...args) => adapter.filterQuotes(...args);
export const createQuote = (...args) => adapter.createQuote(...args);
export const updateQuote = (...args) => adapter.updateQuote(...args);
export const deleteQuote = (...args) => adapter.deleteQuote(...args);
export const bulkUpdateQuotes = (...args) => adapter.bulkUpdateQuotes(...args);
'@
[System.IO.File]::WriteAllText($dataClientPath, $dataClient, [System.Text.UTF8Encoding]::new($false))

Write-Host "Applied Base44-active / Salesforce-ready fixes." -ForegroundColor Green
Write-Host "Active data source: base44" -ForegroundColor Green
Write-Host "Backup directory: $backupDir"
Write-Host "Next commands:"
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run desktop:installer"
