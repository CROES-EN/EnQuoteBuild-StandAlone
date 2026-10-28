// Homeowner tracking links work identically from the desktop app (IPC -> Worker) and the
// browser (cookie session -> Worker gateway); both bridges expose the same three calls.
const MESSAGES = {
  quote_not_synced: "This quote hasn't reached the shared service yet. Try again in a minute.",
  quote_missing_site_id: "Add a site ID to this quote first. Homeowners enter it to open the link.",
  tracking_not_configured: "Homeowner tracking links aren't configured on the shared service yet.",
  not_connected: "EnQuote is still connecting to the shared service. Try again in a moment.",
  unreachable: "Couldn't reach the shared service. Check your connection and try again."
};

function bridge() {
  const api = globalThis.window?.enquoteLocal?.trackingLinks;
  if (!api) throw new Error("Homeowner tracking links need the shared service.");
  return api;
}

export function trackingQuoteId(quote) {
  if (quote?.base44_id) return String(quote.base44_id);
  const id = String(quote?.id || "");
  return id && !id.startsWith("demo-") ? id : null;
}

async function call(method, quoteId) {
  try {
    const result = await bridge()[method](quoteId);
    if (result?.ok === false) {
      const code = result.reason && result.reason !== "error" ? result.reason : result.error;
      throw Object.assign(new Error(MESSAGES[code] || result.error || "Request failed."), { handled: true });
    }
    return result;
  } catch (error) {
    if (error.handled) throw error;
    throw new Error(MESSAGES[error.code] || MESSAGES[error.message] || error.message || "Request failed.");
  }
}

export const getTrackingLink = async quoteId => (await call("get", quoteId))?.link || null;
export const createTrackingLink = async quoteId => (await call("create", quoteId))?.link || null;
export const revokeTrackingLink = quoteId => call("revoke", quoteId);
export const hasTrackingLinkBridge = () => Boolean(globalThis.window?.enquoteLocal?.trackingLinks);
