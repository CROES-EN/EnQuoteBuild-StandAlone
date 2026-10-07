export const APP_LINK_QUERY = "enquoteShareTarget";

export function splitAppPath(value) {
  const index = value.indexOf("?");
  return index < 0 ? [value, ""] : [value.slice(0, index), value.slice(index + 1)];
}

export function validAppPath(value) {
  if (typeof value !== "string" || value.length > 2000 ||
      [...value].some(character => character.charCodeAt(0) <= 32 || character === "\\") ||
      !/^\/(?:[A-Za-z][A-Za-z0-9_-]*)?(?:\?[^#]*)?$/.test(value)) return false;
  const params = new URLSearchParams(splitAppPath(value)[1]);
  return ![...params.keys()].some(key => /token|password|secret|authorization/i.test(key));
}

export function validAppTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.kind === "page") return true;
  if (!["record", "id", "testid", "text"].includes(target.kind) ||
      typeof target.value !== "string" || !target.value.trim() || target.value.length > 200) return false;
  return target.kind !== "text" || /^(a|button|label|h[1-6]|p|span|div|td|th|li|section)$/.test(target.tag || "");
}

export function validAppLink(item) {
  return item?.type === "app_link" && typeof item.label === "string" &&
    Boolean(item.label.trim()) && item.label.length <= 160 &&
    validAppPath(item.path) && validAppTarget(item.target);
}

export function appLinkUrl(item) {
  if (!validAppLink(item)) throw new Error("This EnQuote link is invalid.");
  const [pathname, query] = splitAppPath(item.path);
  const params = new URLSearchParams(query);
  params.set(APP_LINK_QUERY, JSON.stringify(item.target));
  return `${pathname}?${params}`;
}
