const STYLE_BLOCK = /<style[\s\S]*?(?:<\/style>|$)/gi;
const LAYOUT_LINK = /^\s*https?:\/\/\S+\s*$/i;

// Plain-language summary of pasted theme code so the editor can say what was found and what will be skipped.
export function describeTheme(code) {
  const text = String(code || "");
  if (!text.trim()) return {kind: "empty"};
  if (LAYOUT_LINK.test(text)) return {kind: "link"};
  const hasStyleTags = /<style[\s>]/i.test(text);
  if (!hasStyleTags && !/[^{}]+\{[^{}]*:[^{}]*\}/.test(text)) return {kind: "notCode"};
  const credit = text.match(/(?:layout\s+)?(?:created|made|coded|designed)\s+by\s+([^\n<>()]{1,60}?)\s*(?:\(|-->|\n|$)/i)?.[1].trim() || "";
  const outside = hasStyleTags ? text.replace(STYLE_BLOCK, " ").replace(/<!--[\s\S]*?-->/g, " ") : "";
  const sources = [...outside.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]*)/gi)].map((match) => match[1]);
  const images = sources.filter((src) => /^https:\/\//i.test(src)).length;
  return {
    kind: "theme",
    credit,
    images,
    skippedImages: sources.length - images,
    skippedNotes: Boolean(outside.replace(/<[^>]*>/g, " ").trim()),
    background: /background(?:-image)?\s*:[^;{}]*url\(/i.test(text)
  };
}

export function themeSummary(info) {
  if (info.kind !== "theme") return "";
  const found = [info.background && "background art", info.images && `${info.images} ${info.images === 1 ? "image" : "images"}`].filter(Boolean);
  const skipped = [info.skippedNotes && "setup notes", info.skippedImages && `${info.skippedImages} placeholder ${info.skippedImages === 1 ? "image" : "images"}`].filter(Boolean);
  return [
    `Theme added${info.credit ? ` — by ${info.credit}` : ""}.`,
    found.length ? `Includes ${found.join(" and ")}.` : "",
    skipped.length ? `Skipped ${skipped.join(" and ")} that only make sense on SpaceHey.` : ""
  ].filter(Boolean).join(" ");
}
