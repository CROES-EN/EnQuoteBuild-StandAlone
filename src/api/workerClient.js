import { getWebToken } from "../lib/webAuth.js";

export async function workerRequest(path, { method = "GET", body, headers = {}, binary = false } = {}) {
  const token = getWebToken();
  const response = await fetch(path, {
    method, credentials: "same-origin", signal: AbortSignal.timeout(60000),
    headers: {
      ...(token ? { "X-EnQuote-User": token } : {}),
      ...(body !== undefined && !(body instanceof Blob) && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    ...(body === undefined ? {} : { body: body instanceof Blob || body instanceof Uint8Array ? body : JSON.stringify(body) })
  });
  if (binary && response.ok) {
    return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get("content-type") || "application/octet-stream" };
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("The shared service returned an unexpected response. Check your connection.");
  const result = await response.json();
  if (!response.ok || result?.ok === false) {
    const error = new Error(result.message || result.error || result.reason || `Shared service failed (${response.status}).`);
    error.code = result.error || result.reason;
    error.status = response.status;
    error.details = result;
    if (response.status === 401) globalThis.window?.dispatchEvent(new Event("enquote:session-expired"));
    throw error;
  }
  return result;
}

export function browserApi(path, options) {
  if (!path.startsWith("/api/")) throw new Error("Invalid shared API path.");
  return workerRequest(path.replace(/^\/api\//, "/api/browser/"), options);
}
