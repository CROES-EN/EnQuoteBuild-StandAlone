const {validateAnswers} = require("../shared/refundForm.cjs");

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const SCOPE = "https://graph.microsoft.com/Lists.SelectedOperations.Selected";
const STATUSES = ["Submitted", "Under Review", "Approved", "Denied", "Completed", "Cancelled"];
const ANSWER_COLUMNS = {
  cancellationTiming: "Cancellation Timing",
  refundChoice: "Refund Choice",
  refundAmountRequested: "Refund Amount (USD)",
  servicesCompleted: "Services Completed",
  customerEscalated: "Customer Escalated",
  siteId: "Site ID",
  subscriptionId: "Subscription ID",
  customerName: "Customer Name",
  customerEmail: "Customer Email",
  caseNumber: "Case Number",
  refundReason: "Primary Reason",
  otherReason: "Other Reason",
  additionalNotes: "Detailed Explanation"
};
const PROCESSING_COLUMNS = {
  status: "Request Status",
  storeTeamNotes: "Store Team Notes",
  escalationNotes: "Escalation Notes"
};

function configurationIssues(config) {
  const issues = [];
  for (const key of ["tenantId", "clientId", "testListId", "productionListId"]) {
    if (!GUID.test(config?.[key] || "")) issues.push(`${key} must be a valid GUID.`);
  }
  const site = String(config?.graphSiteId || "").split(",");
  if (site.length !== 3 || site[0] !== "enphase.sharepoint.com" ||
      !GUID.test(site[1]) || !GUID.test(site[2])) {
    issues.push("graphSiteId must identify the approved enphase.sharepoint.com site.");
  }
  if (config?.redirectUri !== "http://localhost") issues.push("redirectUri must be http://localhost.");
  if (!Array.isArray(config?.scopes) || config.scopes.length !== 1 || config.scopes[0] !== SCOPE) {
    issues.push("scopes must contain only the approved delegated List scope.");
  }
  if (!Number.isInteger(config?.refreshIntervalMs) || config.refreshIntervalMs < 10000 ||
      config.refreshIntervalMs > 300000) issues.push("refreshIntervalMs must be between 10000 and 300000.");
  return issues;
}

class RefundSharePointError extends Error {
  constructor(message, {status = null, retryAfter = null, retryable = false} = {}) {
    super(message);
    this.name = "RefundSharePointError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.retryable = retryable;
  }
}

// Dormant main-process transport: token acquisition and caller authorization are not implemented here.
function createRefundSharePointClient({config, target = "test", getAccessToken, fetchImpl = fetch, timeoutMs = 20000}) {
  const issues = configurationIssues(config);
  if (issues.length) throw new Error(`SharePoint configuration is incomplete: ${issues.join(" ")}`);
  if (!["test", "production"].includes(target)) throw new Error("Choose the test or production List explicitly.");
  if (typeof getAccessToken !== "function") throw new Error("Microsoft token acquisition is required.");
  const listId = target === "test" ? config.testListId : config.productionListId;
  const root = `${GRAPH_ROOT}/sites/${config.graphSiteId}/lists/${listId}`;
  const listPath = `${new URL(root).pathname}/`;
  let columns;

  function isListUrl(value) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.origin === "https://graph.microsoft.com" && !url.username && !url.password &&
        !url.hash && url.pathname.startsWith(listPath);
    } catch {
      return false;
    }
  }

  async function request(url, {method = "GET", body, headers = {}} = {}) {
    if (!isListUrl(url)) throw new Error("Refusing a Graph URL outside the configured refund List.");
    const token = await getAccessToken();
    if (typeof token !== "string" || !token.trim()) throw new Error("Microsoft sign-in is required.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method, redirect: "error", signal: controller.signal,
        headers: {Authorization: `Bearer ${token}`, Accept: "application/json",
          ...(body ? {"Content-Type": "application/json"} : {}), ...headers},
        ...(body ? {body: JSON.stringify(body)} : {})
      });
      if (!response.ok) {
        const message = response.status === 412
          ? "This request changed in SharePoint. Refresh and review the newer values before saving."
          : response.status === 401 ? "Microsoft sign-in expired. Sign in again."
          : response.status === 403 ? "Microsoft denied access to the refund List. Check user access, app consent, and the List grant."
          : `SharePoint request failed (HTTP ${response.status}).`;
        throw new RefundSharePointError(message, {
          status: response.status, retryAfter: response.headers.get("Retry-After"),
          retryable: response.status === 429 || response.status >= 500
        });
      }
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new RefundSharePointError("Microsoft Graph returned an invalid JSON response.");
      }
    } catch (error) {
      if (error instanceof RefundSharePointError) throw error;
      throw new RefundSharePointError(
        controller.signal.aborted
          ? "SharePoint request timed out. A write may have completed; retry submissions only with their original submission ID."
          : "Could not reach Microsoft Graph. A write may have completed; retry submissions only with their original submission ID.",
        {retryable: true}
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function collection(url) {
    const values = [], visited = new Set();
    while (url) {
      if (visited.has(url) || visited.size >= 1000) throw new Error("Invalid or excessive Graph pagination; no partial result returned.");
      visited.add(url);
      const result = await request(url);
      if (!Array.isArray(result?.value)) throw new Error("Microsoft Graph returned an invalid collection.");
      values.push(...result.value);
      const next = result["@odata.nextLink"];
      if (next !== undefined && !isListUrl(next)) {
        throw new Error("Refusing Graph pagination outside the configured refund List.");
      }
      url = next;
    }
    return values;
  }

  async function fieldMap() {
    if (!columns) {
      const metadata = await collection(`${root}/columns?$select=name,displayName`);
      const result = new Map();
      for (const column of metadata) {
        if (typeof column.displayName !== "string" || typeof column.name !== "string") {
          throw new Error("Invalid SharePoint column metadata.");
        }
        if (result.has(column.displayName)) throw new Error(`Ambiguous SharePoint column: ${column.displayName}.`);
        result.set(column.displayName, column.name);
      }
      columns = result;
    }
    return columns;
  }

  async function mappedFields(values) {
    const map = await fieldMap(), fields = {};
    for (const [displayName, value] of Object.entries(values)) {
      const name = map.get(displayName);
      if (!name) throw new Error(`The refund List is missing the ${displayName} column.`);
      fields[name] = value;
    }
    return fields;
  }

  async function findSubmission(key) {
    const field = (await fieldMap()).get("Submission Key");
    if (!field) throw new Error("The refund List is missing the Submission Key column.");
    const filter = encodeURIComponent(`${field} eq '${key.replace(/'/g, "''")}'`);
    const items = await collection(`${root}/items?$expand=fields&$filter=${filter}&$top=2`);
    if (items.length > 1) throw new Error("Duplicate refund submission keys found. Stop processing and reconcile the List.");
    return items[0] || null;
  }

  return {
    list: () => collection(`${root}/items?$expand=fields&$top=200`),
    async submit({submissionId, answers, requesterEmail, submittedAt}) {
      if (!GUID.test(submissionId || "")) throw new Error("A durable submission UUID is required.");
      const validated = validateAnswers(answers);
      if (!validated) throw new Error("Refund answers failed business validation.");
      if (typeof requesterEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
        throw new Error("A verified requester email is required.");
      }
      if (typeof submittedAt !== "string" || !Number.isFinite(Date.parse(submittedAt))) {
        throw new Error("The original submission timestamp is required.");
      }
      const key = `enquote:${submissionId.toLowerCase()}`;
      const existing = await findSubmission(key);
      if (existing) return {item: existing, created: false};
      const values = Object.fromEntries(Object.entries(ANSWER_COLUMNS).map(([answer, column]) => [column, validated[answer]]));
      Object.assign(values, {
        Title: validated.caseNumber, "Submission Key": key, "Submission Source": "EnQuote",
        "Requester Email": requesterEmail, "Submitted At": submittedAt,
        "Request Status": "Submitted", "Manager Approved": "Pending", "Integration Status": "Pending"
      });
      const fields = await mappedFields(values);
      try {
        const item = await request(`${root}/items`, {method: "POST", body: {fields}});
        if (!item?.id) throw new Error("SharePoint did not return the created refund item.");
        return {item, created: true};
      } catch (error) {
        if (error.status !== 409) throw error;
        const committed = await findSubmission(key);
        if (!committed) throw error;
        return {item: committed, created: false};
      }
    },
    async updateProcessing({id, eTag, changes}) {
      if (!/^[1-9]\d*$/.test(String(id))) throw new Error("A valid SharePoint item ID is required.");
      if (typeof eTag !== "string" || !eTag.trim() || eTag.trim() === "*" || /[\r\n]/.test(eTag)) {
        throw new Error("The item's last-read eTag is required; unconditional updates are not allowed.");
      }
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
        throw new Error("Processing changes are required.");
      }
      const values = {};
      for (const [key, value] of Object.entries(changes)) {
        if (!Object.hasOwn(PROCESSING_COLUMNS, key)) throw new Error(`Unsupported processing field: ${key}.`);
        if (key === "status" ? !STATUSES.includes(value) : typeof value !== "string" || value.length > 4000) {
          throw new Error(`Invalid processing value for ${key}.`);
        }
        values[PROCESSING_COLUMNS[key]] = value;
      }
      return request(`${root}/items/${id}/fields`, {
        method: "PATCH", headers: {"If-Match": eTag}, body: await mappedFields(values)
      });
    }
  };
}

module.exports = {configurationIssues, createRefundSharePointClient, RefundSharePointError};
