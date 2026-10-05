// Authenticated client for the Worker's per-user endpoints (tasks, SOP library, messages).
// Every call carries the shared sync token AND the signed per-user token, so the Worker
// identifies the caller from the token it issued rather than from anything the app claims.
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 120 * 1000;

class CollabError extends Error {
  constructor(message, { status = 0, code = "", offline = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.offline = offline;
  }
}

function createCollabClient({
  workerUrl,
  getOutboundToken,
  getUserToken,
  getAccessHeaders = () => ({}),
  fetchImpl = globalThis.fetch
}) {
  function isReady() {
    return Boolean(getOutboundToken() && getUserToken());
  }

  function authHeaders() {
    const token = getOutboundToken();
    const userToken = getUserToken();
    if (!token || !userToken) {
      throw new CollabError("EnQuote is still connecting to the sync service.", { code: "not_connected", offline: true });
    }
    return { Authorization: `Bearer ${token}`, "X-EnQuote-User": userToken, ...getAccessHeaders() };
  }

  async function send(method, route, { json, body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const init = {
      method,
      headers: { ...authHeaders(), ...headers },
      signal: AbortSignal.timeout(timeoutMs)
    };
    if (json !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    try {
      return await fetchImpl(new URL(route, workerUrl), init);
    } catch (error) {
      throw new CollabError(`Could not reach the sync service (${error.message}).`, { code: "unreachable", offline: true });
    }
  }

  async function request(method, route, options) {
    const response = await send(method, route, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Reported below.
    }
    if (!response.ok || !payload?.ok) {
      const code = payload?.error || `http_${response.status}`;
      throw new CollabError(code, { status: response.status, code });
    }
    return payload;
  }

  const query = (params) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
  };

  return {
    isReady,
    get: (route, params = {}) => request("GET", `${route}${query(params)}`),
    post: (route, json) => request("POST", route, { json }),
    async upload(route, { bytes, type, name }) {
      return request("POST", route, {
        body: bytes,
        headers: { "Content-Type": type || "application/octet-stream", "X-File-Name": encodeURIComponent(name || "file") },
        timeoutMs: UPLOAD_TIMEOUT_MS
      });
    },
    async download(route) {
      const response = await send("GET", route, { timeoutMs: UPLOAD_TIMEOUT_MS });
      if (!response.ok) {
        let code = `http_${response.status}`;
        try {
          code = (await response.json())?.error || code;
        } catch {
          // Non-JSON error body.
        }
        throw new CollabError(code, { status: response.status, code });
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        type: response.headers.get("Content-Type") || "application/octet-stream"
      };
    }
  };
}

module.exports = { createCollabClient, CollabError };
