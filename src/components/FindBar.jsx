import {useCallback, useEffect, useRef, useState} from "react";
import {ChevronDown, ChevronUp, X} from "lucide-react";

const MAX_MATCHES = 5000;
const SEARCH_DEBOUNCE_MS = 150;
const REFRESH_DEBOUNCE_MS = 400;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "TITLE"]);
const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

function isVisible(element, cache) {
  if (cache.has(element)) return cache.get(element);
  const visible = typeof element.checkVisibility === "function"
    ? element.checkVisibility({ checkVisibilityCSS: true })
    : true;
  cache.set(element, visible);
  return visible;
}

// Finds every visible occurrence of `query` in the page's text (case-insensitive), skipping
// the find bar itself so it never matches its own contents.
function findRanges(query) {
  const ranges = [];
  if (!query) return ranges;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const visibility = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && ranges.length < MAX_MATCHES; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text || !text.trim()) continue;
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    if (!match) continue;
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest("[data-find-bar]") || !isVisible(parent, visibility)) continue;
    while (match && ranges.length < MAX_MATCHES) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
      match = pattern.exec(text);
    }
  }
  return ranges;
}

function paintHighlights(ranges, index) {
  if (!supportsHighlights) return;
  if (ranges.length) {
    CSS.highlights.set("find-all", new Highlight(...ranges));
    const current = new Highlight(ranges[index]);
    current.priority = 1;
    CSS.highlights.set("find-current", current);
  } else {
    clearHighlights();
  }
}

function clearHighlights() {
  if (!supportsHighlights) return;
  CSS.highlights.delete("find-all");
  CSS.highlights.delete("find-current");
}

function scrollToRange(range) {
  range?.startContainer?.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
}

/**
 * App-wide Ctrl+F (Cmd+F on macOS) "find in page". Mounted once at the app root so it works on
 * every screen. Enter / Shift+Enter (or F3 / Shift+F3) step through matches, Esc closes.
 */
export default function FindBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ count: 0, index: 0, capped: false });
  const inputRef = useRef(null);
  const rangesRef = useRef([]);
  const indexRef = useRef(0);

  const runSearch = useCallback((text, { keepIndex = false, scroll = true } = {}) => {
    const ranges = findRanges(text);
    rangesRef.current = ranges;
    const index = keepIndex ? Math.min(indexRef.current, Math.max(ranges.length - 1, 0)) : 0;
    indexRef.current = index;
    paintHighlights(ranges, index);
    if (scroll && ranges.length) scrollToRange(ranges[index]);
    setResult({ count: ranges.length, index, capped: ranges.length >= MAX_MATCHES });
  }, []);

  const step = useCallback((direction) => {
    const ranges = rangesRef.current;
    if (!ranges.length) return;
    const index = (indexRef.current + direction + ranges.length) % ranges.length;
    indexRef.current = index;
    paintHighlights(ranges, index);
    scrollToRange(ranges[index]);
    setResult((previous) => ({ ...previous, index }));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    rangesRef.current = [];
    clearHighlights();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const isFind = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        const selected = String(window.getSelection?.() || "").trim();
        if (selected && selected.length <= 100 && !selected.includes("\n")) setQuery(selected);
        setOpen(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      } else if (event.key === "F3") {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape" && !event.defaultPrevented && inputRef.current && document.activeElement === inputRef.current) {
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [step, close]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, runSearch]);

  // Pages keep loading/updating while the bar is open, so quietly re-scan after the DOM changes.
  useEffect(() => {
    if (!open || !query) return undefined;
    let timer = null;
    const observer = new MutationObserver((mutations) => {
      if (mutations.every((m) => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest("[data-find-bar]"))) return;
      clearTimeout(timer);
      timer = setTimeout(() => runSearch(query, { keepIndex: true, scroll: false }), REFRESH_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [open, query, runSearch]);

  useEffect(() => clearHighlights, []);

  if (!open) return null;

  const label = !query ? "" : result.count === 0 ? "No results" : `${result.index + 1} of ${result.count}${result.capped ? "+" : ""}`;

  return (
    <div
      data-find-bar
      role="search"
      className="fixed right-4 top-3 z-[10000] flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 shadow-lg"
    >
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }
        }}
        placeholder="Find in page"
        aria-label="Find in page"
        className="w-52 bg-transparent px-1 text-sm outline-none placeholder:text-slate-400"
      />
      <span className="min-w-[4.5rem] text-right text-xs tabular-nums text-slate-500" aria-live="polite">{label}</span>
      <button type="button" aria-label="Previous match" disabled={!result.count} onClick={() => step(-1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-40">
        <ChevronUp className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Next match" disabled={!result.count} onClick={() => step(1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-40">
        <ChevronDown className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Close find" onClick={close} className="rounded p-1 hover:bg-slate-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
