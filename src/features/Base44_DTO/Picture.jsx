import {useEffect, useState} from "react";
import {profilesApi} from "@/features/profiles/profileApi";
import {sniffImageType} from "./imageType";

const PICTURE_TIMEOUT_MS = 5000;

async function readAsDataUrl(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error("Could not read the uploaded profile picture.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new Error("Profile picture is not a PNG, JPEG, GIF, or WebP image.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(new DOMException("Aborted", "AbortError")); };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, {once: true});
    reader.onload = () => { signal.removeEventListener("abort", abort); resolve(typeof reader.result === "string" ? reader.result : ""); };
    reader.onerror = () => { signal.removeEventListener("abort", abort); reject(reader.error || new Error("Could not read profile picture.")); };
    reader.readAsDataURL(new Blob([bytes], {type}));
  });
}

// Profiles render in a sandboxed iframe that can't see the app's blob: URLs, so EnQuote avatars are inlined as data URLs.
// `ready` stays false until the current set of emails has been looked up, so callers can avoid rendering placeholders first.
export function useProfilePictures(emails) {
  const key = [...new Set(emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean))].sort().join("\n");
  const [state, setState] = useState({key: "", pictures: {}});
  useEffect(() => {
    const wanted = key ? key.split("\n") : [];
    if (!wanted.length) return undefined;
    let controller;
    async function load() {
      controller?.abort();
      const current = controller = new AbortController();
      try {
        const directory = await profilesApi.list();
        const results = await Promise.allSettled(wanted.map(async (email) => {
          const avatarId = directory.find((profile) => String(profile.email || "").toLowerCase() === email)?.avatarId;
          if (!avatarId) return [email, ""];
          const avatar = await profilesApi.acquireAvatar(avatarId);
          try { return [email, await readAsDataUrl(avatar.url, current.signal)]; }
          finally { avatar.release(); }
        }));
        if (current.signal.aborted) return;
        results.forEach((result) => {
          if (result.status === "rejected" && result.reason?.name !== "AbortError") console.warn("[retro] Could not load profile picture:", result.reason?.message);
        });
        setState({key, pictures: Object.fromEntries(results.filter((result) => result.status === "fulfilled" && result.value[1]).map((result) => result.value))});
      } catch (error) {
        if (current.signal.aborted) return;
        console.warn("[retro] Could not load profile pictures:", error.message);
        setState((previous) => previous.key === key ? previous : {key, pictures: {}});
      }
    }
    // A slow or offline sync service must not hold the profile on its loading state; late pictures still swap in.
    const timer = setTimeout(() => setState((previous) => previous.key === key ? previous : {key, pictures: {}}), PICTURE_TIMEOUT_MS);
    void load();
    const off = profilesApi.onChanged(load);
    return () => { clearTimeout(timer); controller?.abort(); off(); };
  }, [key]);
  return {pictures: key && state.key === key ? state.pictures : {}, ready: !key || state.key === key};
}