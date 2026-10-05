import {useEffect, useState} from "react";

const bridge = () => globalThis.window?.enquoteLocal || {};
const avatarUrls = new Map();
let profilesCache = null;
let profilesPromise = null;

function errorFrom(result) {
  return result?.reason || result?.error || "Something went wrong. Try again.";
}

async function call(group, method, ...args) {
  const fn = bridge()[group]?.[method];
  if (typeof fn !== "function") throw new Error("This feature is only available in the EnQuote desktop app.");
  const result = await fn(...args);
  if (result?.ok === false) throw new Error(errorFrom(result));
  return result;
}

async function listProfiles({ refresh = false } = {}) {
  if (!refresh && profilesCache) return profilesCache;
  if (!refresh && profilesPromise) return profilesPromise;
  profilesPromise = call("profiles", "list").then((result) => {
    profilesCache = Array.isArray(result?.profiles) ? result.profiles : [];
    return profilesCache;
  }).finally(() => {
    profilesPromise = null;
  });
  return profilesPromise;
}

function clearProfilesCache() {
  profilesCache = null;
}

export const profilesApi = {
  list: listProfiles,
  async setAvatar({ bytes, type }) {
    const result = await call("profiles", "setAvatar", { bytes, type });
    clearProfilesCache();
    return result?.avatarId;
  },
  async removeAvatar() {
    const result = await call("profiles", "removeAvatar");
    clearProfilesCache();
    return result;
  },
  async getAvatar(avatarId) {
    if (avatarUrls.has(avatarId)) return avatarUrls.get(avatarId);
    const result = await call("profiles", "getAvatar", avatarId);
    const blob = new Blob([result.bytes], { type: result.type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    avatarUrls.set(avatarId, url);
    return url;
  },
  onChanged(callback) {
    const fn = bridge().profiles?.onChanged;
    if (typeof fn !== "function") return () => {};
    return fn(() => {
      clearProfilesCache();
      callback?.();
    });
  }
};

export const gifsApi = {
  search: async (payload) => {
    const result = await call("gifs", "search", payload || {});
    return { gifs: Array.isArray(result?.gifs) ? result.gifs : [], nextOffset: result?.nextOffset ?? null };
  },
  trending: async (payload) => {
    const result = await call("gifs", "trending", payload || {});
    return { gifs: Array.isArray(result?.gifs) ? result.gifs : [], nextOffset: result?.nextOffset ?? null };
  }
};

export function useAvatar(email) {
  const [state, setState] = useState({ url: "", loading: false });
  useEffect(() => {
    let cancelled = false;
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) {
      setState({ url: "", loading: false });
      return undefined;
    }
    async function load() {
      setState((current) => ({ ...current, loading: true }));
      try {
        const profiles = await profilesApi.list();
        const avatarId = profiles.find((profile) => profile.email === normalized)?.avatarId;
        const url = avatarId ? await profilesApi.getAvatar(avatarId) : "";
        if (!cancelled) setState({ url, loading: false });
      } catch {
        if (!cancelled) setState({ url: "", loading: false });
      }
    }
    void load();
    const off = profilesApi.onChanged(load);
    return () => {
      cancelled = true;
      off();
    };
  }, [email]);
  return state;
}
