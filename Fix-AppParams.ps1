# Fix-AppParams.ps1
# Run this from your EnQuote project root:
#   C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\EnQuote
#
# This OVERWRITES src\lib\app-params.js with a known-good version that
# reads VITE_BASE44_APP_ID from .env.local (falling back to the
# production app id if that env var isn't set), and removes any
# duplicated/broken lines left over from manual editing.

$targetPath = ".\src\lib\app-params.js"

if (-not (Test-Path $targetPath)) {
    Write-Host "ERROR: Could not find $targetPath" -ForegroundColor Red
    Write-Host "Make sure you're running this script from the EnQuote project root." -ForegroundColor Yellow
    exit 1
}

# Back up the current (possibly broken) file first, just in case.
$backupPath = ".\src\lib\app-params.js.bak"
Copy-Item -Path $targetPath -Destination $backupPath -Force
Write-Host "Backed up existing file to $backupPath" -ForegroundColor Cyan

$content = @'
const isNode =
  typeof window === "undefined";

const windowObj = isNode
  ? { localStorage: new Map() }
  : window;

const storage = windowObj.localStorage;

const toSnakeCase = (value) =>
  value
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase();

const getAppParamValue = (
  paramName,
  {
    defaultValue = undefined,
    removeFromUrl = false
  } = {}
) => {
  if (isNode) {
    return defaultValue;
  }

  const storageKey =
    `base44_${toSnakeCase(paramName)}`;

  const urlParams =
    new URLSearchParams(
      window.location.search
    );

  const searchParam =
    urlParams.get(paramName);

  if (removeFromUrl) {
    urlParams.delete(paramName);

    const newUrl =
      `${window.location.pathname}` +
      `${urlParams.toString()
        ? `?${urlParams.toString()}`
        : ""}` +
      `${window.location.hash}`;

    window.history.replaceState(
      {},
      document.title,
      newUrl
    );
  }

  if (searchParam) {
    storage.setItem(
      storageKey,
      searchParam
    );

    return searchParam;
  }

  if (
    defaultValue !== undefined &&
    defaultValue !== null &&
    defaultValue !== ""
  ) {
    storage.setItem(
      storageKey,
      defaultValue
    );

    return defaultValue;
  }

  return storage.getItem(storageKey);
};

const cleanWebUrl = (value) => {
  if (!value) {
    return null;
  }

  const cleaned =
    String(value)
      .trim()
      .replace(/\/+$/, "");

  if (
    !cleaned ||
    cleaned === "null" ||
    /^file:/i.test(cleaned)
  ) {
    return null;
  }

  return cleaned;
};

const getAppBaseUrl = () =>
  cleanWebUrl(
    getAppParamValue("app_base_url")
  ) ||
  cleanWebUrl(
    import.meta.env
      .VITE_BASE44_APP_BASE_URL
  ) ||
  "https://enquote.base44.app";

const getServerUrl = () =>
  cleanWebUrl(
    import.meta.env
      .VITE_BASE44_SERVER_URL
  ) ||
  "https://base44.app";

const getAppParams = () => {
  if (
    getAppParamValue(
      "clear_access_token"
    ) === "true"
  ) {
    storage.removeItem(
      "base44_access_token"
    );

    storage.removeItem("token");
  }

  return {
    appId: getAppParamValue("app_id", {
      defaultValue: import.meta.env.VITE_BASE44_APP_ID || "6979390a3f44099ffca06859"
    }),

    token: getAppParamValue(
      "access_token",
      {
        removeFromUrl: true
      }
    ),

    fromUrl: getAppParamValue(
      "from_url",
      {
        defaultValue:
          isNode
            ? ""
            : window.location.href
      }
    ),

    functionsVersion:
      getAppParamValue(
        "functions_version",
        {
          defaultValue:
            import.meta.env
              .VITE_BASE44_FUNCTIONS_VERSION ||
            "prod"
        }
      ),

    appBaseUrl: getAppBaseUrl(),

    serverUrl: getServerUrl()
  };
};

export const appParams = {
  ...getAppParams()
};
'@

Set-Content -Path $targetPath -Value $content -Encoding UTF8 -NoNewline
Write-Host "app-params.js has been rewritten cleanly." -ForegroundColor Green

# Quick sanity check: try to catch obvious duplication/mismatch issues
$openBraces = ([regex]::Matches($content, "\{")).Count
$closeBraces = ([regex]::Matches($content, "\}")).Count
if ($openBraces -ne $closeBraces) {
    Write-Host "WARNING: Brace mismatch detected ({ count: $openBraces, } count: $closeBraces). Please review the file." -ForegroundColor Yellow
} else {
    Write-Host "Brace check passed ($openBraces pairs)." -ForegroundColor Green
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Run .\Update-EnvLocal.ps1 to make sure VITE_BASE44_APP_ID is set in .env.local"
Write-Host "2. Restart your dev server (stop it with Ctrl+C, then re-run npm run dev)"
Write-Host "3. In the browser console on localhost:5173, run: localStorage.removeItem('base44_app_id')"
Write-Host "4. Reload localhost:5173 and confirm API calls now use the sandbox app id (6a91e7bce36dd777fa88cf04)"
