// Browser sessions use an HttpOnly cookie. Legacy localStorage tokens are migrated on validation.

const TOKEN_KEY = "enquote_web_token";
const EMAIL_KEY = "enquote_local_session_email";

export function getWebToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function getWebEmail() {
  try {
    return localStorage.getItem(EMAIL_KEY) || null;
  } catch {
    return null;
  }
}

export function setWebSession(token, email) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // localStorage unavailable
  }
}

export function clearWebSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    // localStorage unavailable
  }
}

// Validate the stored token against the Worker's /auth/session endpoint.
// Uses a relative URL so it works with the Vite dev proxy and same-origin in production.
export async function validateWebToken() {
  const token = getWebToken();

  try {
    const resp = await fetch("/auth/session", {
      credentials: "same-origin",
      headers: token ? { "X-EnQuote-User": token } : {},
    });
    const data = await resp.json();
    if (data.authenticated) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.setItem(EMAIL_KEY, data.email);
    }
    return data;
  } catch {
    return { authenticated: false, reason: "network_error" };
  }
}

// Login with email + password. The Worker checks against ALLOWED_EMAILS_LIST
// and the per-user password hash stored in D1.
export async function webLogin(email, password) {
  const resp = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(data.reason || "Login failed");
  }
  clearWebSession();
  if (data.userToken) setWebSession(data.userToken, data.email);
  else localStorage.setItem(EMAIL_KEY, data.email);
  localStorage.removeItem("enquote_base44_api_key");
  return data;
}

// First-time password setup. Only works for emails in ALLOWED_EMAILS_LIST
// that don't already have a password set.
export async function webRegister(email, password) {
  const resp = await fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(data.reason || "Registration failed");
  }
  clearWebSession();
  if (data.userToken) setWebSession(data.userToken, data.email);
  else localStorage.setItem(EMAIL_KEY, data.email);
  localStorage.removeItem("enquote_base44_api_key");
  return data;
}

export async function webLogout() {
  const response = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not sign out. Please try again.");
  localStorage.removeItem("enquote_base44_api_key");
  clearWebSession();
}
