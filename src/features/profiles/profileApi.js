import {useEffect, useState} from "react";
import {createAvatarCache} from "./avatarCache";
import {AVATAR_TYPES, avatarTypeFromBytes} from "../../../shared/avatarRules.js";

const bridge = () => globalThis.window?.enquoteLocal || {};
const avatarCache = createAvatarCache({
  load: (id) => call("profiles", "getAvatar", id),
  createUrl: (result) => {
    const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
    const declaredType = String(result.type || "").split(";")[0].trim().toLowerCase();
    const type = avatarTypeFromBytes(bytes) || (AVATAR_TYPES.has(declaredType) ? declaredType : "application/octet-stream");
    return URL.createObjectURL(new Blob([bytes], {type}));
  },
  revokeUrl: (url) => URL.revokeObjectURL(url)
});
if (import.meta.hot) import.meta.hot.dispose(() => avatarCache.dispose());
let profilesCache = null;
let profilesPromise = null;

function errorFrom(result) {
  const code = result?.reason || result?.error;
  const messages = {
    file_too_large: "Profile pictures must be 512 KB or smaller.",
    invalid_gif_avatar: "That file is not a supported GIF image.",
    gif_dimensions_too_large: "GIF profile pictures must be 1024px or smaller on each side.",
    unsupported_type: "Choose a PNG, JPEG, WebP, or GIF profile picture."
  };
  return messages[code] || code || "Something went wrong. Try again.";
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
  if (profilesPromise) return profilesPromise;
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
  acquireAvatar: avatarCache.acquire,
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
    let releaseAvatar;
    let loadVersion = 0;
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) {
      setState({ url: "", loading: false });
      return undefined;
    }
    async function load() {
      const version = ++loadVersion;
      setState((current) => ({ ...current, loading: true }));
      try {
        const profiles = await profilesApi.list();
        if (cancelled || version !== loadVersion) return;
        const avatarId = profiles.find((profile) => profile.email === normalized)?.avatarId;
        const avatar = avatarId ? await profilesApi.acquireAvatar(avatarId) : null;
        if (cancelled || version !== loadVersion) {
          avatar?.release();
          return;
        }
        releaseAvatar?.();
        releaseAvatar = avatar?.release;
        setState({ url: avatar?.url || "", loading: false });
      } catch (error) {
        if (!cancelled && version === loadVersion) {
          console.warn("[profiles] Could not load profile picture:", error.message);
          setState((current) => ({...current, loading: false}));
        }
      }
    }
    void load();
    const off = profilesApi.onChanged(load);
    return () => {
      cancelled = true;
      releaseAvatar?.();
      off();
    };
  }, [email]);
  return state;
}
