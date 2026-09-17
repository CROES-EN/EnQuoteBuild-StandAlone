import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUpDown, GripVertical, Search, ChevronRight, Pencil, Settings2, FileText, User, Users, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/quotes/StatusBadge";
import { buildQuoteMatchIndex, findMatchingQuotes } from "@/features/supervisorDashboard/quoteMatchLookup";
import { getOMStatusBadgeClasses, getProjectPicklistBadgeClasses, calcOpenDays } from "@/features/supervisorDashboard/workloadStatusColors";
import { getWorkloadGoal, setWorkloadGoal } from "@/features/supervisorDashboard/workloadGoal";
import {
  getTiles,
  getTileForStatus,
  getTileForRow,
  getColumnOrder,
  setColumnOrder as saveColumnOrderPref,
  getHiddenWorkloadColumns,
  getDefaultSortColumn,
  getRowDensity,
  getManagementReviewNames,
  isManagementReviewMatch,
  getMyCaseOwnerName,
  setMyCaseOwnerName as saveMyCaseOwnerName,
  isMyCaseMatch,
  markRowsSeen,
  isRowSeen
} from "@/features/supervisorDashboard/workloadPreferences";
import WorkloadSettingsPanel from "@/components/supervisor/WorkloadSettingsPanel";
import { getCurrentUser } from "@/api/dataClient";

// Safety cap for the drag-and-drop column reorder's sliding (FLIP) animation - if a reorder
// would touch an unreasonably large number of cells (e.g. a future much-larger import), skip
// the animation and let the reorder apply instantly instead of risking visible jank. This
// table isn't virtualized (see the component's own header comment below), so this guard keeps
// that assumption from becoming a performance trap as data grows.
const MAX_ANIMATED_CELLS = 4000;

// Long free-text columns - wrap onto multiple lines with a sensible min-width instead of
// forcing single-line + horizontal scroll. Not user-configurable (a layout concern, not a
// customization one) - always the same 3 regardless of column order/visibility settings.
const WRAP_COLUMNS = new Set(["Subject", "Contact: Email", "New_Location"]);

// FIX (per explicit follow-up request - "I wanted to filter ALL columns"): every real,
// present column now gets a filter icon in its header - there is no longer an exclusion list.
// The only thing that stays unfilterable is the "Open" column (column key "__open"), since
// it's not a real imported data column at all - it's a LIVE-computed value (days since last
// modified, recalculated every render/every day), so a fixed checkbox list of its values would
// be meaningless and would silently go stale. "__open" is handled separately below (it isn't
// part of `presentColumns`, so it was never offered a filter to begin with) - every column
// that DOES come from the import (O&M Status, Status, Subject, Contact Name, etc. - all of
// them, with no exceptions) is now filterable.

/** Small colored pill - renders the tile's icon in place of the plain dot when the status is
 *  mapped to a tile. */
function ColorPill({ classes }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", classes.bg,classes.text)}>
      {classes.icon ? (
        <span aria-hidden="true">{classes.icon}</span>
      ) : (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", classes.dot)} />
      )}
      {classes.label}
    </span>
  );
}

/** Full-detail popup for one row - kept as a convenience even though every column is in the grid. */
function RowDetailsDialog({ open, onOpenChange, columns, row }) {
  if (!row) return null;
  const openDays = calcOpenDays(row["Case Date/Time Last Modified"]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row["Case Number"] || "Case Details"}</DialogTitle>
        </DialogHeader>
        <dl className="divide-y divide-border">
          <div className="grid grid-cols-3 gap-4 py-2.5 text-sm">
            <dt className="col-span-1 font-medium text-muted-foreground">Open (live)</dt>
            <dd className="col-span-2 text-foreground">{openDays === null ? "--" : `${openDays} day${openDays === 1 ? "" : "s"}`}</dd>
          </div>
          {columns.filter((c) => c !== "Open").map((col) => (
            <div key={col} className="grid grid-cols-3 gap-4 py-2.5 text-sm">
              <dt className="col-span-1 font-medium text-muted-foreground">{col}</dt>
              <dd className="col-span-2 whitespace-pre-wrap break-words text-foreground">
                {row?.[col] || "None"}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lists every EnQuote quote matched to one Workload row (by Site ID or Case Number), each its
 * own clickable entry showing real, verifiable fields (site ID/quote number, case number,
 * status, last-updated date) - replaces the earlier version's behavior of silently jumping to
 * just the single most-recently-updated match, which gave no way to confirm a match was
 * actually correct before landing on a quote. Multiple matches for one site ARE expected and
 * normal in this app (site_id is the grouping key across quote revisions/versions - e.g. a
 * rejected v1, a resubmitted v2, an approved v3 for the same site), so seeing several entries
 * here is not automatically a bug - this dialog lets the user directly verify whether the
 * matches genuinely belong to this case before trusting any of them.
 */
function QuoteMatchesDialog({ matches, onOpenChange }) {
  return (
    <Dialog open={Boolean(matches)} onOpenChange={(open) => !open && onOpenChange()}>
      <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{matches?.length || 0} Matching Quote{matches?.length === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {(matches || []).map((q) => (
            <Link
              key={q.id}
              to={`${createPageUrl("QuoteDetails")}?id=${q.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary px-3 py-2.5 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {q.site_id || q.quote_number || "(no site ID)"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {q.case_number ? `Case ${q.case_number} - ` : ""}
                  Updated {q.updated_date ? new Date(q.updated_date).toLocaleDateString() : "unknown date"}
                </p>
              </div>
              <StatusBadge status={q.status} size="small" />
            </Link>
          ))}
          {(!matches || matches.length === 0) && (
            <p className="py-6 text-center text-sm text-muted-foreground">No matching quotes.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Minimal Excel-style per-column checkbox filter popover - "clean and minimalistic" per
 * explicit request, deliberately WITHOUT Excel's sort/color/text-filter clutter: just a
 * search box (useful when a column has many distinct values), a "Select All" toggle, and a
 * plain checkbox list of every distinct value present in this column across the CURRENT scope
 * (My Cases or All Cases - see the component-level comment on WorkloadReportTable for why),
 * plus Apply/Clear actions. Positioned as a small floating panel anchored under the header's
 * filter icon, closes on an outside click or Escape, matching standard popover conventions
 * elsewhere in this app (e.g. the existing Select/Dialog components already used here).
 */
function ColumnFilterPopover({ column, distinctValues, selectedValues, onApply, onClear, onClose, anchorRef }) {
  const [draft, setDraft] = useState(() => new Set(selectedValues ?? distinctValues));
  const [search, setSearch] = useState("");
  const popoverRef = useRef(null);

  // Closes on any click outside the popover (but not on the header's own filter icon, which
  // has its own toggle handler) - standard popover dismissal behavior.
  useEffect(() => {
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
          anchorRef.current && !anchorRef.current.contains(e.target)) {
        onClose();
      }
    }
    function handleEscape(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, anchorRef]);

  const visibleValues = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return distinctValues;
    return distinctValues.filter((v) => v.toLowerCase().includes(term));
  }, [distinctValues, search]);

  const allVisibleChecked = visibleValues.length > 0 && visibleValues.every((v) => draft.has(v));

  function toggleValue(value) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setDraft((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) {
        visibleValues.forEach((v) => next.delete(v));
      } else {
        visibleValues.forEach((v) => next.add(v));
      }
      return next;
    });
  }

  function handleApply() {
    // Selecting EVERY distinct value is equivalent to "no filter" - clear the filter entirely
    // in that case, rather than storing a redundant "all selected" filter state. This keeps
    // the "filter active" indicator (a filled filter icon vs. an outline one) meaningful: it
    // only lights up when the filter is actually narrowing something down.
    if (draft.size === distinctValues.length) {
      onClear();
    } else {
      onApply(draft);
    }
    onClose();
  }

  return (
    <div
      ref={popoverRef}
      className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-card p-2 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Search values..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 pl-6 text-xs"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 border-b border-border px-1 py-1.5 text-xs font-medium text-foreground">
        <input
          type="checkbox"
          checked={allVisibleChecked}
          onChange={toggleSelectAllVisible}
          className="h-3.5 w-3.5 rounded border-border"
        />
        Select All
      </label>
      <div className="max-h-52 overflow-y-auto py-1">
        {visibleValues.map((value) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-foreground hover:bg-secondary">
            <input
              type="checkbox"
              checked={draft.has(value)}
              onChange={() => toggleValue(value)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            <span className="truncate">{value}</span>
          </label>
        ))}
        {visibleValues.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">No values match your search.</p>
        )}
      </div>
      <div className="mt-2 flex justify-end gap-1.5 border-t border-border pt-2">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { onClear(); onClose(); }}>
          Clear
        </Button>
        <Button size="sm" className="h-6 px-2 text-xs" onClick={handleApply}>
          OK
        </Button>
      </div>
    </div>
  );
}

/**
 * Real, fully user-customizable table view for the Workload page. Everything that used to be
 * hardcoded (which statuses are "important", their labels/icons/colors, column visibility/
 * order, default sort column, row density) now comes from workloadPreferences.js, editable via
 * the gear-icon Settings panel. A `prefsVersion` counter forces every preference-reading memo
 * to recompute after Settings closes with a save, since localStorage reads aren't reactive on
 * their own (same "bump a counter to force reread" pattern already used by ReportDataTable.jsx
 * for its own column/summary-field preferences).
 *
 * TILE MATCHING (FIXED): this Salesforce export has TWO separate status fields - "O&M Status"
 * (quote-progression: Remote Troubleshooting, Pending Schedule, Quote Draft, etc.) and "Status"
 * (generic case-workflow: Escalated, Needs Review, Updated by Client, etc.) - confirmed via
 * explicit user documentation this session. Every place below that decides "is this row
 * mapped to a tile" now calls getTileForRow(row, tiles) - which checks O&M Status FIRST, then
 * falls back to Status - instead of the old getTileForStatus(row["O&M Status"], tiles), which
 * only ever checked O&M Status and silently missed any row whose important value lived in the
 * Status field instead. The O&M Status COLUMN'S OWN BADGE COLOR is deliberately left calling
 * getOMStatusBadgeClasses(row["O&M Status"], tile) unchanged, so a row matched via the Status
 * field doesn't have its O&M Status pill wrongly recolored to a tile it doesn't literally
 * belong to.
 *
 * "MY CASES" / "ALL CASES" toggle: this page DEFAULTS to showing only the signed-in user's
 * own cases (Case Owner match, auto-resolved and silently saved the first time this table
 * ever loads with nothing configured), rather than defaulting to the whole team's report. A
 * single toggle button switches between the two views. EVERY count on this page (every tile,
 * "Review Me") is computed from whichever scope is CURRENTLY selected (see `scopedRows`
 * below) - so switching between My Cases/All Cases changes every visible number consistently.
 * The toggle button itself shows no count badge (removed per explicit feedback that a
 * mismatched-color badge showing a different number than the "X Total Cases" label was
 * confusing) - it's a plain icon+label control, highlighted only while showing "My Cases"
 * (meaning you're viewing the whole team and a click returns you to your own).
 *
 * COLUMN FILTERS: per explicit request, modeled loosely on Excel's own column filter dropdown
 * but deliberately simpler ("clean and minimalistic") - EVERY real, present column (per a
 * follow-up explicit request removing an earlier exclusion list) gets a small filter icon that
 * opens a checkbox list of every distinct value present in that column, computed from the
 * CURRENT scope (so filtering "Case Owner" while viewing All Cases sees every teammate's
 * names, while viewing My Cases only sees your own name). The only column that has no filter
 * is "Open" (column key "__open"), since it's a LIVE-computed value (days since last
 * modified), not real imported data - a fixed checkbox list of its values would be meaningless
 * and go stale immediately. Column filters combine with AND logic across columns, and layer on
 * TOP of (not instead of) the existing scope/tile/Review Me/search filters. A filter icon
 * fills in (solid) when that column currently has an active, narrowing filter.
 *
 * Deliberately NOT virtualized - this is a personal case tracker, not a multi-thousand-row
 * report; can be revisited if this ever grows to NICE-Raw-Data-like row counts.
 */
export default function WorkloadReportTable({ table, onReload, isReloading }) {
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState(() => getDefaultSortColumn());
  const [sortDirection, setSortDirection] = useState("asc");
  const [detailsRow, setDetailsRow] = useState(null);
  const [quoteMatchesForDialog, setQuoteMatchesForDialog] = useState(null);
  const [activeTileFilter, setActiveTileFilter] = useState(null);
  const [reviewMeOnly, setReviewMeOnly] = useState(false);
  // Default FALSE = "showing only my own cases" (the default behavior). Set to TRUE by
  // clicking the toggle button to see the entire team's report regardless of Case Owner.
  const [allCasesMode, setAllCasesMode] = useState(false);
  const [goal, setGoalState] = useState(() => getWorkloadGoal());
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(() => String(getWorkloadGoal()));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefsVersion, setPrefsVersion] = useState(0);
  // Bumped whenever a tile is clicked (marking its cases as seen) - separate from
  // prefsVersion (which is about tile/column/sort/density CONFIGURATION changes) since this is
  // about read/unread STATE for the current data, and needs to recompute independently.
  const [seenVersion, setSeenVersion] = useState(0);

  // --- Column filters ---------------------------------------------------------------------
  // Map of column name -> Set of currently-SELECTED (i.e. NOT excluded) values for that
  // column. A column absent from this map means "no filter active, show everything" - this
  // is deliberate (rather than always storing every column's full value set) so clearing a
  // filter is a simple "delete this key" and the "is any column filtered" check is a cheap
  // "is this map non-empty".
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterColumn, setOpenFilterColumn] = useState(null);
  const filterAnchorRefs = useRef({});

  function getFilterAnchorRef(column) {
    if (!filterAnchorRefs.current[column]) {
      filterAnchorRefs.current[column] = { current: null };
    }
    return filterAnchorRefs.current[column];
  }

  function applyColumnFilter(column, selectedSet) {
    setColumnFilters((prev) => ({ ...prev, [column]: selectedSet }));
  }

  function clearColumnFilter(column) {
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[column];
      return next;
    });
  }

  function clearAllColumnFilters() {
    setColumnFilters({});
  }

  // Quotes list, loaded once for cross-referencing Site ID/Case Number against EnQuote's own
  // quotes (per explicit request) - refreshed on mount and on window focus/visibility change,
  // matching the same pattern already used elsewhere on this page, since a quote could be
  // created/updated in another part of the app while this page stays open.
  const [quotes, setQuotes] = useState([]);
  useEffect(() => {
    let cancelled = false;
    async function loadQuotes() {
      try {
        const list = await globalThis.window?.enquoteLocal?.quotes?.list?.();
        if (!cancelled) setQuotes(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setQuotes([]);
      }
    }
    loadQuotes();
    function handleVisibility() {
      if (document.visibilityState === "visible") loadQuotes();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, []);
  const quoteMatchIndex = useMemo(() => buildQuoteMatchIndex(quotes), [quotes]);

  // --- Click-and-drag column reordering directly on the table headers, with a sliding
  // (FLIP) animation - per explicit request.
  //
  // Uses POINTER events (pointerdown/pointermove/pointerup), NOT the browser's native HTML5
  // drag-and-drop API - switched away from native drag-and-drop after it was reported as "not
  // very sensitive." The likely cause: native HTML5 drag-and-drop's dragover event is known to
  // fire inconsistently/coarsely over `position: sticky` elements in Chromium (these table
  // headers are sticky, so they stay pinned while the table scrolls) - this is a well-known
  // browser quirk, not something tunable via CSS/timing. Pointer events use direct, continuous
  // hit-testing we control ourselves (comparing the cursor's live position against each
  // header's cached bounding rect), firing at native mousemove frequency regardless of sticky
  // positioning - this is the same underlying technique virtually all modern "buttery smooth"
  // drag interactions use. Still no new npm dependency - just the standard Pointer Events Web
  // API already available in every modern browser/Electron.
  //
  // A small floating "chip" (ghostRef below) follows the cursor directly via an imperative,
  // ref-based transform update on every pointermove - deliberately NOT routed through React
  // state, since a state update + re-render on every single mousemove event would itself
  // introduce the kind of lag/stutter this fix is meant to eliminate. Only the LESS frequent
  // "which column am I currently over" change goes through React state (draggedColumn/
  // dragOverColumn), since that only changes when the cursor crosses into a new column, not on
  // every pixel of movement.
  //
  // The actual reorder is still only committed ONCE, on pointer release (not continuously
  // while dragging) - this keeps the FLIP animation logic below completely unchanged from the
  // previous pass, and keeps the interaction simple and predictable: pick a column up, see it
  // dim, see the live-highlighted drop target update instantly and smoothly as you move, drop
  // it, watch the affected columns slide into place.
  const tableWrapperRef = useRef(null);
  const flipSnapshotRef = useRef(null);
  const ghostRef = useRef(null);
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  function showGhost(label, x, y) {
    const el = ghostRef.current;
    if (!el) return;
    el.textContent = label;
    el.style.opacity = "1";
    moveGhost(x, y);
  }

  function moveGhost(x, y) {
    const el = ghostRef.current;
    if (!el) return;
    // translate3d (not translate) to keep this on the GPU compositor - the single biggest
    // factor in making cursor-following feel instant/lag-free rather than choppy.
    el.style.transform = `translate3d(${x + 14}px, ${y + 10}px, 0)`;
  }

  function hideGhost() {
    const el = ghostRef.current;
    if (!el) return;
    el.style.opacity = "0";
  }

  const tiles = useMemo(() => getTiles(), [prefsVersion]);
  const columnOrder = useMemo(() => getColumnOrder(), [prefsVersion]);
  const hiddenColumns = useMemo(() => getHiddenWorkloadColumns(), [prefsVersion]);
  const density = useMemo(() => getRowDensity(), [prefsVersion]);
  const managementNames = useMemo(() => getManagementReviewNames(), [prefsVersion]);
  const myName = useMemo(() => getMyCaseOwnerName(), [prefsVersion]);
  const cellPadding = density === "compact" ? "py-1" : "py-2";
  const headerPadding = density === "compact" ? "py-1.5" : "py-2";

  // Auto-resolve and silently persist "My Name" the FIRST time this table ever loads with
  // nothing configured yet, so the default "my cases only" filtering works immediately out
  // of the box - without this, a user who never opens Customize would see zero cases by
  // default (isMyCaseMatch always returns false for an unconfigured name), which would look
  // like a bug rather than the intended default. Never overwrites an already-configured name -
  // this only ever fires once, the very first time getMyCaseOwnerName() comes back empty. The
  // name remains fully editable afterward in Customize (e.g. if a Salesforce Case Owner value
  // is formatted differently than the signed-in user's real name).
  useEffect(() => {
    if (getMyCaseOwnerName()) return;
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        const resolvedName = user?.full_name || user?.name || "";
        if (!cancelled && resolvedName) {
          saveMyCaseOwnerName(resolvedName);
          setPrefsVersion((v) => v + 1);
        }
      } catch {
        // Could not resolve a signed-in user - "my cases" filtering will show 0 results until
        // a name is set manually in Customize; the All Cases toggle still works regardless.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSettingsSaved() {
    setPrefsVersion((v) => v + 1);
    // Reset any active tile filter, since tiles/mappings may have just changed underneath it.
    setActiveTileFilter(null);
  }

  // The rows currently "in scope" - either just the signed-in user's own cases (Case Owner
  // match, the default) or the entire imported report (All Cases mode). EVERYTHING below this
  // point - tile counts, unseen counts, Review Me's count, the search/sort/filter table itself,
  // and the summary "X of Y"/"Total" label - is derived from this SAME scoped set, so every
  // button's count and the visible table always agree with whichever view is currently
  // selected.
  const scopedRows = useMemo(() => {
    if (!table?.rows) return [];
    if (allCasesMode) return table.rows;
    return table.rows.filter((row) => isMyCaseMatch(row["Case Owner"], myName));
  }, [table, allCasesMode, myName]);

  const rowsWithOpen = useMemo(() => {
    return scopedRows.map((row) => ({ row, openDays: calcOpenDays(row["Case Date/Time Last Modified"]) }));
  }, [scopedRows]);

  // Total size of the currently selected scope (My Cases or All Cases) - the denominator for
  // the "X of Y"/"Total" summary label, and the basis for the empty-scope message below.
  const scopeTotal = scopedRows.length;

  const presentColumns = useMemo(() => {
    if (!table?.columns) return [];
    return columnOrder.filter((col) => table.columns.includes(col) && !hiddenColumns.has(col));
  }, [table, columnOrder, hiddenColumns]);

  // Every distinct value present in EVERY present column - computed from the CURRENT scope
  // (scopedRows) - so a column's filter list only ever shows values that could actually appear
  // given the current My Cases/All Cases selection, never stale values from a scope you're not
  // even looking at. Recomputes whenever scopedRows or the visible column set changes. No
  // column is excluded here anymore (per explicit follow-up request) - every present column
  // gets its distinct-value list computed, and therefore gets a working filter icon.
  const distinctColumnValues = useMemo(() => {
    const result = {};
    presentColumns.forEach((col) => {
      const values = new Set();
      scopedRows.forEach((row) => {
        const v = row[col];
        if (v !== null && v !== undefined && v !== "") values.add(String(v));
      });
      result[col] = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    });
    return result;
  }, [presentColumns, scopedRows]);

  // Runs the "Last-Invert-Play" half of the FLIP animation right after a reorder-driven
  // re-render commits. The "First" (before) measurement already happened synchronously inside
  // handleHeaderDrop, stored in flipSnapshotRef - this effect only needs to read each element's
  // NEW position, compute the delta from its OLD position, and animate it sliding back to 0.
  useLayoutEffect(() => {
    const snapshot = flipSnapshotRef.current;
    flipSnapshotRef.current = null;
    if (!snapshot || snapshot.length === 0) return;
    snapshot.forEach(({ el, rect: oldRect }) => {
      if (!el.isConnected) return;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      if (Math.abs(dx) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
      // Force a reflow so the browser registers the starting transform before we animate it
      // away - without this, the browser can coalesce both style writes into one paint and the
      // "slide" never actually shows.
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
      requestAnimationFrame(() => {
        el.style.transition = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "";
      });
      const cleanup = () => {
        el.style.transition = "";
        el.style.transform = "";
        el.removeEventListener("transitionend", cleanup);
      };
      el.addEventListener("transitionend", cleanup);
    });
  }, [presentColumns]);

  // Captures {element, rect} for every header/body cell belonging to one of `affectedColumns`,
  // BEFORE the reorder is applied - this is the "First" measurement in FLIP. Bails out (no
  // animation, reorder still applies instantly) if there's nothing to animate or if the cell
  // count exceeds MAX_ANIMATED_CELLS, per the safety cap explained above.
  function captureFlipSnapshot(affectedColumns) {
    const root = tableWrapperRef.current;
    if (!root || affectedColumns.size === 0) { flipSnapshotRef.current = null; return; }
    const elements = Array.from(root.querySelectorAll("[data-flip-col]")).filter((el) =>
      affectedColumns.has(el.getAttribute("data-flip-col"))
    );
    if (elements.length === 0 || elements.length > MAX_ANIMATED_CELLS) {
      flipSnapshotRef.current = null;
      return;
    }
    flipSnapshotRef.current = elements.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  }

  // Commits the actual reorder - identical logic to the previous native-drag-and-drop version's
  // drop handler, just now invoked from pointerup instead of a native onDrop event.
  function commitColumnReorder(sourceColumn, targetColumn) {
    if (!sourceColumn || !targetColumn || sourceColumn === targetColumn) return;

    // Reorder the FULL stored column order (including any currently-hidden columns), not just
    // the visible subset - this keeps hidden columns' relative position stable and stays in
    // sync with whatever Customize's column list shows, since both read/write the same
    // underlying preference.
    const fullOrder = getColumnOrder();
    const sourceIdx = fullOrder.indexOf(sourceColumn);
    const targetIdx = fullOrder.indexOf(targetColumn);
    if (sourceIdx < 0 || targetIdx < 0) return;

    // Only the VISIBLE columns strictly between the dragged column's old and new position
    // actually shift by one slot - that's all that needs to animate.
    const oldVisibleIdx = presentColumns.indexOf(sourceColumn);
    const newVisibleIdx = presentColumns.indexOf(targetColumn);
    if (oldVisibleIdx >= 0 && newVisibleIdx >= 0) {
      const lo = Math.min(oldVisibleIdx, newVisibleIdx);
      const hi = Math.max(oldVisibleIdx, newVisibleIdx);
      captureFlipSnapshot(new Set(presentColumns.slice(lo, hi + 1)));
    }

    const nextFullOrder = [...fullOrder];
    nextFullOrder.splice(sourceIdx, 1);
    nextFullOrder.splice(targetIdx, 0, sourceColumn);
    saveColumnOrderPref(nextFullOrder);
    setPrefsVersion((v) => v + 1);
  }

  // Starts a pointer-based column drag. Everything needed for the ENTIRE drag (the moving
  // column's identity, and which column the cursor currently sits over) is captured in local
  // closures here - `onMove`/`onUp` are defined fresh inside this function every time a drag
  // starts, so they always see the correct, current values with zero risk of the classic
  // React stale-closure bug that using a single set of component-level handlers would risk.
  function handleGripPointerDown(e, column) {
    e.preventDefault();
    const root = tableWrapperRef.current;
    if (!root) return;

    // Cache every draggable header's position ONCE, at drag start - since the reorder itself
    // only commits on release (not continuously while dragging), header positions never
    // change mid-drag, so one snapshot here is all the hit-testing below ever needs.
    const headerEls = Array.from(root.querySelectorAll("thead [data-flip-col]"));
    if (headerEls.length === 0) return;
    const rects = headerEls.map((el) => ({ column: el.getAttribute("data-flip-col"), rect: el.getBoundingClientRect() }));

    let currentOverColumn = column;
    setDraggedColumn(column);
    setDragOverColumn(column);
    showGhost(column, e.clientX, e.clientY);

    // Prevents accidental text selection while dragging across the header row, and shows a
    // grabbing cursor over the whole page (not just the grip handle) for the duration of the
    // drag - both small but noticeable contributors to a drag interaction feeling "off"/janky
    // if left as default browser behavior.
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    function onMove(ev) {
      moveGhost(ev.clientX, ev.clientY);
      let found = currentOverColumn;
      for (const { column: col, rect } of rects) {
        if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
          found = col;
          break;
        }
      }
      if (found !== currentOverColumn) {
        currentOverColumn = found;
        setDragOverColumn(found);
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      hideGhost();
      setDraggedColumn(null);
      setDragOverColumn(null);
      commitColumnReorder(column, currentOverColumn);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // Live count per tile - drives both the summary strip and the goal/celebration logic.
  //
  // Every count below is computed from `scopedRows` (My Cases or All Cases, whichever is
  // currently selected) instead of always `table.rows` (the full report regardless of the
  // toggle) - per explicit request, every button's count must "match depending on what's
  // selected". Now every tile, and Review Me's own count, are always in agreement with the
  // currently visible scope. NOTE: these deliberately do NOT additionally factor in column
  // filters - tile/Review Me counts represent "how many important/flagged cases exist in this
  // scope", independent of whatever column filter narrowing you're ALSO applying to the visible
  // table at the same time (the same design already used for the search box, which also
  // doesn't affect these counts).
  const tileCounts = useMemo(() => {
    const counts = {};
    tiles.forEach((t) => { counts[t.id] = 0; });
    scopedRows.forEach((row) => {
      const tile = getTileForRow(row, tiles);
      if (tile) counts[tile.id] = (counts[tile.id] || 0) + 1;
    });
    return counts;
  }, [scopedRows, tiles]);
  const totalImportant = Object.values(tileCounts).reduce((sum, n) => sum + n, 0);
  const showCelebration = totalImportant < goal;

  // Unseen (not-yet-clicked) count per tile - drives the small notification dot on each tile
  // button. Recomputes whenever the underlying data changes OR seenVersion bumps (i.e. right
  // after a tile is clicked and marks its cases as seen). Scoped the same way as tileCounts
  // above - see that comment for why.
  const unseenTileCounts = useMemo(() => {
    const counts = {};
    tiles.forEach((t) => { counts[t.id] = 0; });
    scopedRows.forEach((row) => {
      const tile = getTileForRow(row, tiles);
      if (tile && !isRowSeen(row)) {
        counts[tile.id] = (counts[tile.id] || 0) + 1;
      }
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedRows, tiles, seenVersion]);

  // Live count of cases whose "Case Last Modified By" matches a management review name -
  // drives the badge on the "Review Me" button. Per explicit request, tying Review Me to
  // this column specifically flags cases where management already acted, so the user knows
  // to go look, distinct from the per-status tiles above. Scoped the same way as tileCounts -
  // while viewing "My Cases", this correctly counts only YOUR cases that management touched,
  // not the whole team's.
  const managementReviewCount = useMemo(() => {
    return scopedRows.filter((row) => isManagementReviewMatch(row["Case Last Modified By"], managementNames)).length;
  }, [scopedRows, managementNames]);

  // True if at least one column currently has an active, narrowing filter applied.
  const hasActiveColumnFilters = Object.keys(columnFilters).length > 0;

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    let entries = rowsWithOpen;
    if (term) {
      entries = entries.filter(({ row }) =>
        ["Case Number", "Case Owner", "O&M Status", "Project Picklist", "Subject", "Enlighten Site ID", "Contact Name"]
          .some((col) => String(row[col] ?? "").toLowerCase().includes(term))
      );
    }
    // NOTE: the My Cases/All Cases scoping is already applied UPSTREAM, in scopedRows (which
    // rowsWithOpen - and therefore `entries` here - is already built from). This block only
    // ever needs to apply the tile/Review Me filter on TOP of that already-scoped set, so a
    // tile or Review Me selection while viewing "My Cases" correctly stays limited to your own
    // cases, matching every button's own count (see tileCounts/managementReviewCount above).
    if (activeTileFilter) {
      entries = entries.filter(({ row }) => getTileForRow(row, tiles)?.id === activeTileFilter);
    } else if (reviewMeOnly) {
      // "Review Me" is tied to Case Last Modified By - per explicit request, this filters to
      // cases management has already touched (Denice Ankenman / Heather Mackey / Shane Mosley
      // by default, editable in Customize), NOT the per-status tile definition of "important."
      entries = entries.filter(({ row }) => isManagementReviewMatch(row["Case Last Modified By"], managementNames));
    }
    // Column filters - applied on TOP of everything above, combined with AND logic across
    // every column that currently has an active filter (standard spreadsheet-filter
    // behavior: a row must match EVERY active column filter to remain visible, not just one).
    if (hasActiveColumnFilters) {
      entries = entries.filter(({ row }) =>
        Object.entries(columnFilters).every(([col, allowedValues]) => {
          const cellValue = row[col];
          const cellStr = (cellValue === null || cellValue === undefined || cellValue === "") ? null : String(cellValue);
          // A blank/missing cell only passes if the filter itself doesn't require a specific
          // value to be present - since distinctColumnValues never includes blanks as an
          // option, a blank cell can never be "selected", so it's correctly excluded whenever
          // this column has ANY active filter (matching standard spreadsheet behavior, where
          // filtering a column hides blank cells unless a blank option is explicitly offered
          // and checked - which this minimal version deliberately doesn't offer, per the
          // "clean and minimalistic" request).
          if (cellStr === null) return false;
          return allowedValues.has(cellStr);
        })
      );
    }
    const sorted = [...entries].sort((a, b) => {
      if (sortColumn === "__open") {
        const aImportant = getTileForRow(a.row, tiles) ? 0 : 1;
        const bImportant = getTileForRow(b.row, tiles) ? 0 : 1;
        if (aImportant !== bImportant) return aImportant - bImportant;
        const aVal = a.openDays ?? -Infinity;
        const bVal = b.openDays ?? -Infinity;
        const cmp = aVal - bVal;
        return sortDirection === "asc" ? cmp : -cmp;
      }
      const cmp = String(a.row[sortColumn] ?? "").localeCompare(String(b.row[sortColumn] ?? ""), undefined, { numeric: true });
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rowsWithOpen, search, sortColumn, sortDirection, activeTileFilter, reviewMeOnly, tiles, managementNames, columnFilters, hasActiveColumnFilters]);

  function handleSortClick(column) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function handleTileClick(tileId) {
    setReviewMeOnly(false);
    setActiveTileFilter((prev) => (prev === tileId ? null : tileId));
    // Per explicit request: clicking a tile marks its notification as read. Marks every row
    // CURRENTLY mapped to this tile as seen (not just the ones matching any active search/
    // filter), so the sidebar badge and this tile's own dot both clear immediately - if a case
    // later changes to a different status, it correctly becomes unseen again (see
    // caseStatusFingerprint's header comment in workloadPreferences.js).
    if (table?.rows) {
      const rowsForTile = table.rows.filter((row) => getTileForRow(row, tiles)?.id === tileId);
      markRowsSeen(rowsForTile);
      setSeenVersion((v) => v + 1);
    }
  }

  function handleReviewMeToggle() {
    setActiveTileFilter(null);
    setReviewMeOnly((prev) => !prev);
  }

  // Toggles between "my cases only" (the default) and "all cases" (the whole report,
  // regardless of Case Owner) - per explicit request, this single button's label always
  // describes what clicking it will show you NEXT, not the current state (it reads "All
  // Cases" while filtered to your own, and "My Cases" while showing everyone's). Also clears
  // any active tile/Review Me filter, so this always takes you directly to the requested view.
  function handleAllCasesToggle() {
    setActiveTileFilter(null);
    setReviewMeOnly(false);
    setAllCasesMode((prev) => !prev);
  }

  function handleSaveGoal() {
    const parsed = parseInt(goalDraft, 10);
    const safeValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : goal;
    setWorkloadGoal(safeValue);
    setGoalState(safeValue);
    setEditingGoal(false);
  }

  function handleCancelGoalEdit() {
    setGoalDraft(String(goal));
    setEditingGoal(false);
  }

  function SortableHeader({ column, label, className }) {
    const isActive = sortColumn === column;
    // "Open" stays fixed as the anchored first column (it's the live-calculated column, not
    // a real imported one) - only real, draggable columns get the grip handle and drag events.
    const isDraggable = column !== "__open";
    // FIX: every draggable (i.e. real, imported) column is now filterable - "__open" is the
    // only exception, since it's a live-computed value with no fixed value set (see the
    // component-level comment above for why).
    const isFilterable = isDraggable;
    const columnHasActiveFilter = Boolean(columnFilters[column]);
    const anchorRef = isFilterable ? getFilterAnchorRef(column) : null;

    return (
      <th
        scope="col"
        data-flip-col={isDraggable ? column : undefined}
        className={cn(
          `sticky top-0 z-10 whitespace-nowrap border-b border-border bg-secondary px-3 ${headerPadding} text-left text-xs font-semibold text-foreground transition-colors`,
          isDraggable && draggedColumn === column && "opacity-40",
          isDraggable && dragOverColumn === column && draggedColumn !== column && "bg-indigo-500/10 ring-1 ring-inset ring-indigo-400",
          className
        )}
      >
        <div className="relative flex items-center gap-1">
          {isDraggable && (
            <span
              onPointerDown={(e) => handleGripPointerDown(e, column)}
              title="Drag to reorder column"
              style={{ touchAction: "none" }}
              className="cursor-grab text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
          <button
            type="button"
            onClick={() => handleSortClick(column)}
            className={cn("inline-flex items-center gap-1 hover:text-primary", isActive && "text-primary")}
          >
            {label}
            <ArrowUpDown className="h-3 w-3 shrink-0" />
          </button>
          {isFilterable && (
            <>
              <button
                ref={anchorRef}
                type="button"
                title={columnHasActiveFilter ? `Filtered - showing ${columnFilters[column].size} of ${(distinctColumnValues[column] || []).length} value(s)` : "Filter this column"}
                onClick={(e) => { e.stopPropagation(); setOpenFilterColumn((prev) => (prev === column ? null : column)); }}
                className={cn(
                  "ml-auto rounded p-0.5 hover:bg-secondary/80",
                  columnHasActiveFilter ? "text-indigo-600" : "text-muted-foreground/40 hover:text-foreground"
                )}
              >
                <Filter className={cn("h-3 w-3", columnHasActiveFilter && "fill-current")} />
              </button>
              {openFilterColumn === column && (
                <ColumnFilterPopover
                  column={column}
                  distinctValues={distinctColumnValues[column] || []}
                  selectedValues={columnFilters[column]}
                  onApply={(selectedSet) => applyColumnFilter(column, selectedSet)}
                  onClear={() => clearColumnFilter(column)}
                  onClose={() => setOpenFilterColumn(null)}
                  anchorRef={anchorRef}
                />
              )}
            </>
          )}
        </div>
      </th>
    );
  }

  if (!table) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No data imported yet. Use "Import Report" to load your Workload export.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tile strip + All Cases/My Cases toggle + Review Me + Settings gear + goal editor */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {tiles.map((tile) => {
            const count = tileCounts[tile.id] || 0;
            const unseenCount = unseenTileCounts[tile.id] || 0;
            const isActive = activeTileFilter === tile.id;
            return (
              <button
                key={tile.id}
                type="button"
                onClick={() => handleTileClick(tile.id)}
                title={unseenCount > 0 ? `${unseenCount} new since you last checked - click to mark as read` : undefined}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                  tile.bg,
                  tile.text,
                  isActive && cn("ring-2 ring-offset-1", tile.ring)
                )}
              >
                {unseenCount > 0 && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" aria-hidden="true" />
                )}
                <span aria-hidden="true">{tile.icon}</span>
                <span className="font-semibold">{count}</span>
                <span>{tile.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleAllCasesToggle}
            title={
              allCasesMode
                ? `Showing the entire report, all ${table.rows.length} case${table.rows.length === 1 ? "" : "s"} - click to show only cases owned by "${myName || "(no name configured)"}" (edit that name in Customize).`
                : `Showing only cases owned by "${myName || "(no name configured)"}" - click to show the entire report. Edit your name in Customize.`
            }
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              allCasesMode ? "border-indigo-500 bg-indigo-500/10 text-indigo-700" : "border-border text-muted-foreground hover:bg-secondary"
            )}
          >
            {allCasesMode ? <User className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
            {allCasesMode ? "My Cases" : "All Cases"}
          </button>
          <button
            type="button"
            onClick={handleReviewMeToggle}
            title="Cases whose 'Case Last Modified By' was one of your Management Review names - edit that list in Customize."
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              reviewMeOnly ? "border-indigo-500 bg-indigo-500/10 text-indigo-700" : "border-border text-muted-foreground hover:bg-secondary"
            )}
          >
            {managementReviewCount > 0 && (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-500 px-1.5 text-xs font-semibold text-white">
                {managementReviewCount}
              </span>
            )}
            Review Me
          </button>
          {hasActiveColumnFilters && (
            <button
              type="button"
              onClick={clearAllColumnFilters}
              title="Clear every active column filter"
              className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              <Filter className="h-3 w-3 fill-current" />
              {Object.keys(columnFilters).length} Column Filter{Object.keys(columnFilters).length === 1 ? "" : "s"}
              <span className="text-indigo-400">&times;</span>
            </button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)} className="text-muted-foreground">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Customize
          </Button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {editingGoal ? (
            <>
              <span>Goal:</span>
              <Input
                type="number"
                min="0"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                className="h-7 w-16 px-2 py-1 text-xs"
              />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleSaveGoal}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleCancelGoalEdit}>Cancel</Button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditingGoal(true)}
              className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              Goal: {goal}
            </button>
          )}
        </div>
      </div>

      {showCelebration && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700">
          {totalImportant === 0
            ? "🎉 Nothing urgent right now - all caught up!"
            : `🎉 Only ${totalImportant} important case${totalImportant === 1 ? "" : "s"} - under your goal of ${goal}. Nice work!`}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">
            {/* Per explicit request: whenever no tile/Review Me/column filter narrows the
                view further, show a plain total ("74 Total Cases") against whichever scope is
                currently selected - your own cases by default, or the whole report in All
                Cases mode - instead of "X of Y". The moment a tile, Review Me, OR a column
                filter is active, show "X of Y" - here Y (scopeTotal) is always the currently
                selected scope's own total. */}
            {!activeTileFilter && !reviewMeOnly && !hasActiveColumnFilters ? (
              <>{scopeTotal} Total Case{scopeTotal === 1 ? "" : "s"}</>
            ) : (
              <>{filteredSorted.length} of {scopeTotal} case{scopeTotal === 1 ? "" : "s"}</>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            From {table.sourceFileName} - imported {new Date(table.importedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search cases..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-7"
            />
          </div>
          {onReload && (
            <Button variant="ghost" size="sm" onClick={onReload} disabled={isReloading}>
              {isReloading ? "Reloading..." : "Reload"}
            </Button>
          )}
        </div>
      </div>

      <div ref={tableWrapperRef} className="max-h-[48rem] w-full overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full table-auto border-collapse text-sm">
          <thead>
            <tr>
              <SortableHeader column="__open" label="Open" />
              {presentColumns.map((col) => (
                <SortableHeader
                  key={col}
                  column={col}
                  label={col}
                  className={WRAP_COLUMNS.has(col) ? "min-w-[14rem]" : undefined}
                />
              ))}
              <th scope="col" className={`sticky top-0 z-10 whitespace-nowrap border-b border-border bg-secondary px-3 ${headerPadding}text-left text-xs font-semibold text-foreground`}>
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map(({ row, openDays }, i) => {
              const tile = getTileForRow(row, tiles);
              const quoteMatches = findMatchingQuotes(quoteMatchIndex, row);
              return (
                <tr
                  key={row["Case ID"] || row["Case Number"] || i}
                  className={cn(
                    tile ? tile.tint : "odd:bg-card even:bg-secondary/40",
                    tile ? tile.border : "border-l-4 border-transparent",
                    "hover:bg-indigo-500/5"
                  )}
                >
                  <td className={`whitespace-nowrap border-b border-border/50 px-3 ${cellPadding} align-top font-semibold text-foreground`}>
                    {openDays === null ? "--" : `${openDays}d`}
                  </td>
                  {presentColumns.map((col) => {
                    const wraps = WRAP_COLUMNS.has(col);
                    // Per explicit request: a badge/icon indicating a matching EnQuote quote
                    // (matched by Site ID OR Case Number), hyperlinked to open it, with a
                    // discrete "+N" indicator when more than one quote matches. Shown attached
                    // to the Case Number cell specifically, since that's the most natural home
                    // for "this case already has a quote" - Enlighten Site ID matches surface
                    // the SAME badge here too (a match on either field is still one combined
                    // result set), so there's only ever one badge per row, not two competing ones.
                    const showQuoteBadge = col === "Case Number" && quoteMatches.length > 0;
                    return (
                      <td
                        key={col}
                        data-flip-col={col}
                        className={cn(
                          `border-b border-border/50 px-3 ${cellPadding} align-top text-foreground`,
                          wraps ? "whitespace-normal break-words min-w-[14rem]" : "whitespace-nowrap"
                        )}
                      >
                        {col === "O&M Status" ? (
                          <ColorPill classes={getOMStatusBadgeClasses(row[col], tile)} />
                        ) : col === "Project Picklist" ? (
                          <ColorPill classes={getProjectPicklistBadgeClasses(row[col])} />
                        ) : showQuoteBadge ? (
                          <div className="flex items-center gap-1.5">
                            <span>{row[col] || "--"}</span>
                            {/* Per explicit request: always shows the exact total match count
                                (+1 for one quote, +2 for two, etc.). Opens a real list of every
                                matched quote (see QuoteMatchesDialog above) instead of silently
                                auto-jumping to one guessed "most likely" quote - lets the user
                                directly verify each match's real site ID/case number/status
                                before trusting it, rather than landing on a possibly wrong
                                quote with no way to see why it was chosen. */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setQuoteMatchesForDialog(quoteMatches); }}
                              title={`${quoteMatches.length} matching quote${quoteMatches.length === 1 ? "" : "s"} - click to view`}
                              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-500/20"
                            >
                              <FileText className="h-3 w-3" />
                              +{quoteMatches.length}
                            </button>
                          </div>
                        ) : row[col] === "" || row[col] === null || row[col] === undefined ? (
                          <span className="text-muted-foreground">--</span>
                        ) : (
                          String(row[col])
                        )}
                      </td>
                    );
                  })}
                  <td className={`whitespace-nowrap border-b border-border/50 px-3 ${cellPadding} align-top`}>
                    <button
                      type="button"
                      onClick={() => setDetailsRow(row)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      View <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {filteredSorted.length === 0 && (
              <tr>
                <td colSpan={presentColumns.length + 2} className="py-8 text-center text-sm text-muted-foreground">
                  {/* Priority order: (1) the import itself is empty, (2) the CURRENT SCOPE
                      (My Cases/All Cases) is entirely empty - true regardless of any
                      search/tile/Review Me/column filter, so this takes priority over a
                      generic "no matches" message, which would be misleading if the real
                      reason is simply that you have zero cases at all, (3) a search/tile/
                      Review Me/column filter excluded everything within an otherwise
                      non-empty scope. */}
                  {table.rows.length === 0
                    ? "No rows in this import."
                    : scopeTotal === 0 && !allCasesMode
                    ? `No cases found for "${myName || "your name"}" - check your name in Customize, or click "All Cases" above to see the entire report.`
                    : "No cases match your current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RowDetailsDialog
        open={Boolean(detailsRow)}
        onOpenChange={(open) => !open && setDetailsRow(null)}
        columns={table.columns}
        row={detailsRow}
      />

      <QuoteMatchesDialog
        matches={quoteMatchesForDialog}
        onOpenChange={() => setQuoteMatchesForDialog(null)}
      />

      <WorkloadSettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={handleSettingsSaved}
      />

      {/* Floating "which column am I dragging" chip - follows the cursor via a direct,
          ref-based transform update (see moveGhost above), never through React state, so it
          tracks the pointer at full frame rate with zero re-render lag. Positioned fixed and
          rendered as the LAST element in this component's output (not nested inside the
          scrollable table wrapper) specifically so it is never clipped by that container's
          overflow:auto, and pointer-events:none so it never itself becomes a drop/hover target. */}
      <div
        ref={ghostRef}
        className="pointer-events-none fixed left-0 top-0 z-50 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg"
        style={{ opacity: 0, willChange: "transform", transition: "opacity 120ms ease" }}
      />
    </div>
  );
}
