import {useEffect, useState} from "react";

const bridge = () => globalThis.window?.enquoteLocal?.admin || null;

function normalizeResult(result) {
  if (result?.ok === false) {
    const error = new Error(friendlyError(result.reason || result.error || "error"));
    error.reason = result.reason || result.error;
    throw error;
  }
  return result || {ok: true};
}

export function friendlyError(code) {
  const map = {
    admin_required: "You need admin access to use this.",
    last_admin: "At least one admin must remain.",
    self_demotion: "You cannot remove your own admin access.",
    roles_unavailable: "Roles are temporarily unavailable. Try again shortly.",
    not_connected: "EnQuote is not connected to the sync service yet.",
    unreachable: "Could not reach the sync service."
  };
  return map[code] || String(code || "Something went wrong.");
}

async function call(name, ...args) {
  const fn = bridge()?.[name];
  if (typeof fn !== "function") return normalizeResult({ok: false, error: "not_connected", reason: "not_connected"});
  return normalizeResult(await fn(...args));
}

export const policy = () => call("policy");
export const overview = () => call("overview");
export const setUserOverride = (payload) => call("setUserOverride", payload);
export const setRolePages = (payload) => call("setRolePages", payload);
export const setAnnouncement = (payload) => call("setAnnouncement", payload);
export const sessions = () => call("sessions");
export const clearSessions = (payload) => call("clearSessions", payload);
export const command = (payload) => call("command", payload);
export const removeChatMessage = (messageId) => call("removeChatMessage", messageId);
export const purgeSop = (id) => call("purgeSop", id);
export const resetAvatar = (email) => call("resetAvatar", email);
export const audit = (payload) => call("audit", payload);

export function useAccessPolicy() {
  const [state, setState] = useState({loading: true, policy: null, error: null});
  useEffect(() => {
    let cancelled = false;
    const load = () => policy()
      .then((result) => {
        if (!cancelled) setState({loading: false, policy: result, error: null});
      })
      .catch((error) => {
        if (!cancelled) setState((previous) => ({...previous, loading: false, error}));
      });
    void load();
    const off = bridge()?.onPolicyChanged?.(() => { void load(); });
    return () => {
      cancelled = true;
      if (typeof off === "function") off();
    };
  }, []);
  return state;
}
