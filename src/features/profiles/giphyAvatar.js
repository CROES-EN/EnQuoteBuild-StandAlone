import {MAX_AVATAR_BYTES, avatarTypeFromBytes, gifAvatarError} from "../../../shared/avatarRules.js";

const GIPHY_HOST = /^(i\.giphy\.com|media[0-9]*\.giphy\.com)$/i;

function safeGiphyUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && GIPHY_HOST.test(url.hostname) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

// GIPHY's 200px-tall GIF first, then its 100px version, then the small animated WebP preview.
export function giphyAvatarCandidates(gif) {
  const urls = [];
  const main = safeGiphyUrl(gif?.url);
  if (main) {
    urls.push(main.href);
    if (/\/200\.gif$/i.test(main.pathname)) {
      const small = new URL(main.href);
      small.pathname = small.pathname.replace(/\/200\.gif$/i, "/100.gif");
      small.searchParams.delete("rid");
      urls.push(small.href);
    }
  }
  const preview = safeGiphyUrl(gif?.previewUrl);
  if (preview) urls.push(preview.href);
  return [...new Set(urls)];
}

export async function downloadGiphyAvatar(gif, fetchImpl = globalThis.fetch) {
  for (const url of giphyAvatarCandidates(gif)) {
    try {
      const response = await fetchImpl(url, {credentials: "omit", referrerPolicy: "no-referrer"});
      if (!response.ok) continue;
      if (Number(response.headers?.get?.("content-length")) > MAX_AVATAR_BYTES) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_AVATAR_BYTES) continue;
      const type = avatarTypeFromBytes(bytes);
      if (type === "image/gif" && !gifAvatarError(bytes)) return {bytes, type};
      if (type === "image/webp") return {bytes, type};
    } catch {
      // Try the next, smaller rendition.
    }
  }
  throw new Error("That GIF is too large for a profile picture. Try another one.");
}
