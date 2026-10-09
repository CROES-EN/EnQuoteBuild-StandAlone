import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {validAppLink, validAppPath, splitAppPath, APP_LINK_QUERY} from "../../../shared/appLinkRules.js";

const EVENT = "enquote_app_link_picker";
let request = null;
const text = element => String(element.textContent || "").replace(/\s+/g, " ").trim();

export function currentAppLinkRequest() {
  return request?.owner === getCurrentUserNamespace() ? request : null;
}

export function onAppLinkPickingChanged(callback) {
  const handler = () => callback(currentAppLinkRequest());
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function startAppLinkSelection(onPicked) {
  const owner = getCurrentUserNamespace();
  if (owner === "__anonymous__") throw new Error("Sign in before sharing an EnQuote link.");
  const next = {owner, onPicked};
  request = next;
  window.dispatchEvent(new Event(EVENT));
  return () => {
    if (request !== next) return;
    request = null;
    window.dispatchEvent(new Event(EVENT));
  };
}

export function finishAppLinkSelection(attachment = null) {
  const current = currentAppLinkRequest();
  request = null;
  window.dispatchEvent(new Event(EVENT));
  if (attachment && current) current.onPicked(attachment);
}

export function pickAppElement(element) {
  const record = element.closest("[data-enquote-share-target]:not([data-enquote-share-scope='groups'])");
  if (record) return record;
  if (element.closest("[data-enquote-share-scope='tiles']")) return null;
  const candidate = element.closest("a,button,label,h1,h2,h3,h4,h5,h6,p,td,th,li,[id],[data-testid]");
  return candidate?.closest("main") ? candidate : element.closest("[data-enquote-share-scope='groups']") || element;
}

export function describeAppElement(element, path) {
  const main = element.closest("main");
  if (!main) throw new Error("Select something in the page content.");
  const record = element.getAttribute("data-enquote-share-target");
  const [pathname, query] = splitAppPath(path);
  const params = new URLSearchParams(query);
  params.delete(APP_LINK_QUERY);
  const currentPath = pathname + (params.size ? `?${params}` : "");
  let destination = currentPath;
  let target;
  if (record) {
    const route = element.getAttribute("data-enquote-share-route") ||
      element.closest("[data-enquote-share-route]")?.getAttribute("data-enquote-share-route");
    if (route && validAppPath(route)) destination = route;
    target = element.getAttribute("data-enquote-share-scope") === "groups"
      ? {kind: "page"} : {kind: "record", value: record};
  } else if (element.id && element.id !== "root") {
    target = {kind: "id", value: element.id};
  } else if (element.getAttribute("data-testid")) {
    target = {kind: "testid", value: element.getAttribute("data-testid")};
  } else {
    const route = element.closest("a")?.getAttribute("href")?.replace(/^#/, "");
    if (route && validAppPath(route) && route !== destination) {
      destination = route;
      target = {kind: "page"};
    } else target = {kind: "text", tag: element.tagName.toLowerCase(), value: text(element)};
  }
  const baseLabel = element.getAttribute("data-enquote-share-label") || element.getAttribute("aria-label") || text(element) || element.getAttribute("title") || "Shared item";
  const quoteContext = element.closest("[data-enquote-share-quote-number]");
  const quoteNumber = quoteContext?.getAttribute("data-enquote-share-quote-number");
  if (quoteNumber && splitAppPath(destination)[0] === "/QuoteDetails") {
    const destinationParams = new URLSearchParams(splitAppPath(destination)[1]);
    destinationParams.set("quoteNumber", quoteNumber);
    destination = `/QuoteDetails?${destinationParams}`;
  }
  const suffix = quoteNumber && quoteContext !== element && baseLabel !== `Quote ${quoteNumber}`
    ? ` - ${quoteNumber}` : "";
  const label = baseLabel.slice(0, Math.max(0, 160 - suffix.length)) + suffix;
  const attachment = {type: "app_link", label, path: destination, target};
  if (!validAppLink(attachment)) throw new Error("Choose a smaller item with a visible label.");
  if (destination === currentPath && !findAppElement(main, target)) {
    throw new Error("That label appears more than once. Select the containing record or a unique label.");
  }
  return attachment;
}

export function findAppElement(root, target) {
  if (target.kind === "page") return root.querySelector("h1");
  const attributes = {record: "data-enquote-share-target", id: "id", testid: "data-testid"};
  const attribute = attributes[target.kind];
  const candidates = [...root.querySelectorAll(attribute ? `[${attribute}]` : target.tag)];
  if (attribute && root.getAttribute(attribute) === target.value) candidates.unshift(root);
  const matches = candidates.filter(element => (attribute
    ? element.getAttribute(attribute) === target.value : text(element) === target.value) &&
    element.getClientRects().length > 0);
  return matches.length === 1 ? matches[0] : null;
}

export function glowSharedElement(element, {setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  element.scrollIntoView({block: "center", behavior: "auto"});
  element.classList.add("enquote-shared-target");
  const timer = setTimer(() => element.classList.remove("enquote-shared-target"), 5000);
  return () => {clearTimer(timer); element.classList.remove("enquote-shared-target");};
}
