import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Upload, Trash2, Search, Sparkles, FileText } from "lucide-react";
import { getReportTable, deleteReportTable } from "@/features/supervisorDashboard/importedTableStore";
import { listGeneratedDrafts, clearAllGeneratedDrafts } from "@/features/autoDrafter/autoDrafterDraftsStore";
import ImportAsTableDialog from "@/components/supervisor/ImportAsTableDialog";
import SalesforceImportButton from "@/components/supervisor/SalesforceImportButton";
import {
  getSalesforceReportUrl,
  setSalesforceReportUrl
} from "@/features/quoteRequestIntake/autoDrafterSalesforceSettings";
import AutoDrafterCaseTile from "@/components/autoDrafter/AutoDrafterCaseTile";
import AutoDrafterDraftDetails from "@/components/autoDrafter/AutoDrafterDraftDetails";

const REPORT_TYPE = "quoteRequestCases";
const REPORT_LABEL = "Quote Request Cases";

/**
 * "Auto-Drafter [beta]" - a new top-level tab sitting between Quotes and Products &
 * Services (per explicit request). This is Stage 1 of the Auto-Drafter build: reliably
 * getting the raw "Quote Request Cases with Case Comments" Salesforce report into EnQuote,
 * via the SAME proven "Salesforce" one-click import button already used by the Workload
 * tab (SalesforceImportButton.jsx) - reused here with a genuinely SEPARATE reportType
 * ("quoteRequestCases", distinct from Workload's own report) and a genuinely SEPARATE
 * saved-URL settings module (autoDrafterSalesforceSettings.js), so this can never collide
 * with or overwrite Workload's own saved report/URL.
 *
 * Deliberately does NOT reuse SpreadsheetGridTable.jsx (the compact-cell grid built for
 * NICE Raw Data's short numeric/short-string values, which force every cell onto a single
 * unwrapped line via whitespace-nowrap - confirmed via reading its real code). This
 * report's real data is fundamentally different in shape: a handful of short identifying
 * fields (Case Number, Site ID, Status, Created Date) alongside ONE long free-text case
 * comment field that regularly runs several paragraphs. A spreadsheet grid would render
 * that comment as one unreadable, extremely long horizontal line. Instead, this uses a
 * simple card-per-case list with the comment shown as wrapped, readable text - the right
 * UI for this report's actual shape, not a repurposed one.
 *
 * GENERATED DRAFTS (autoDrafterDraftsStore.js): loaded ONCE here, at this parent level,
 * into a single Map keyed by case number - NOT independently by each tile. Each
 * AutoDrafterCaseTile only ever receives its OWN matching record as a plain prop.
 *
 * FIX (confirmed real crash, reproduced and root-caused via a live OOM heap-exhaustion
 * crash right after clicking "Generate Draft" with ~100+ cases rendered at once): an
 * earlier revision had EACH TILE independently call getGeneratedDraftForCase() in its own
 * useEffect on mount. electron/repository.cjs's read() re-parses the ENTIRE shared local
 * data file (every quote, every imported report table including all case-comment text) on
 * EVERY SINGLE collections:list call, with no caching - so ~100+ near-simultaneous tile
 * mounts triggered ~100+ independent full-file reads/parses piling up in memory
 * simultaneously, exhausting the JS heap. Fetching the drafts list exactly ONCE here and
 * passing each tile only its own already-resolved record eliminates the redundant reads
 * entirely, regardless of how many cases are on screen.
 *
 * VIEWING A SAVED DRAFT: clicking a saved-draft tile no longer opens a popup dialog --
 * it sets `selectedCaseNumber` here, which swaps the entire case grid for a full-page,
 * read-only AutoDrafterDraftDetails view (styled like QuoteDetails.jsx), still INSIDE
 * this same Auto-Drafter page/tab (no real route/URL is ever created, since there is no
 * real Quote record behind an unsent draft). A "Back to Auto-Drafter" link inside that
 * view clears `selectedCaseNumber` to return to the grid.
 */
export default function AutoDrafter() {
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearDraftsConfirmOpen, setClearDraftsConfirmOpen] = useState(false);
  const [clearingDrafts, setClearingDrafts] = useState(false);
  const [search, setSearch] = useState("");
  const [generatedDraftsByCase, setGeneratedDraftsByCase] = useState({});
  const [selectedCaseNumber, setSelectedCaseNumber] = useState(null);

  const loadTable = useCallback(async ({ showSpinner } = {}) => {
    if (showSpinner) setReloading(true); else setLoading(true);
    try {
      const result = await getReportTable(REPORT_TYPE);
      setTable(result);
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  // Fetches every saved generated draft ONE TIME and indexes it by case number, so
  // individual tiles never need to fetch anything themselves - see the module comment
  // above for why this matters (a real OOM crash this exact change fixes).
  const loadGeneratedDrafts = useCallback(async () => {
    try {
      const all = await listGeneratedDrafts();
      const byCase = {};
      for (const record of all) {
        byCase[record.caseNumber ?? record.id] = record;
      }
      setGeneratedDraftsByCase(byCase);
    } catch (error) {
      console.error("Failed to load saved Auto-Drafter drafts:", error);
    }
  }, []);

  // Same "reload on mount AND on tab re-visibility" pattern already proven in
  // ReportDataTablesPanel.jsx/NiceRawDataPanel.jsx - this page can stay mounted across
  // sidebar navigation depending on router behavior, so a mount-only effect could go stale.
  //
  // FIX (confirmed real bug: "the page is refreshing itself often"): this previously called
  // loadTable() with NO args on every focus/visibility event, which sets `loading = true` -
  // and `loading` blanks the ENTIRE grid to a plain "Loading..." message (see the render
  // logic below). In Electron, the window's `focus` event fires far more often than a user
  // would expect (e.g. clicking between the app and DevTools, or between app windows) - so
  // the whole case grid was repeatedly flashing back to a blank loading state on ordinary
  // focus changes, not just genuine tab revisits. Two fixes:
  //   1. Background re-fetches on focus/visibility now pass { showSpinner: true }, which
  //      only sets the (unused-in-render, purely informational) `reloading` flag instead of
  //      `loading` - so the grid itself is never blanked/replaced during a background
  //      refresh, only on the true initial mount.
  //   2. A simple time-based throttle (skip re-fetching if the last one completed under 2
  //      seconds ago) prevents `visibilitychange` and `focus` firing back-to-back for the
  //      same real event from triggering two redundant fetches in a row.
  const lastRefreshRef = useRef(0);
  const REFRESH_THROTTLE_MS = 2000;

  useEffect(() => {
    loadTable();
    loadGeneratedDrafts();
    lastRefreshRef.current = Date.now();

    function refreshIfDue() {
      const now = Date.now();
      if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      loadTable({ showSpinner: true });
      loadGeneratedDrafts();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") refreshIfDue();
    }
    function handleFocus() {
      refreshIfDue();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadTable, loadGeneratedDrafts]);

  function handleImported() {
    loadTable({ showSpinner: true });
  }

  async function handleConfirmClear() {
    setClearing(true);
    try {
      await deleteReportTable(REPORT_TYPE);
      await loadTable({ showSpinner: true });
    } finally {
      setClearing(false);
      setClearConfirmOpen(false);
    }
  }

  // Resets every SAVED AI-generated draft (autoDrafterDraftsStore.js's separate
  // "autoDrafterGeneratedDrafts" collection) so old drafts stop showing up when the tab is
  // reopened - completely independent of "Clear Data" above, which only clears the
  // IMPORTED case table (quoteRequestCases). Clearing one never affects the other: a
  // cleared imported case table with drafts still saved would just show those cases back
  // in "raw case" mode once re-imported; clearing drafts here does not touch the imported
  // case data at all. Real Quote records already sent via "Send to Quotes" are NEVER
  // touched by this - only unsent Auto-Drafter draft records are removed.
  async function handleConfirmClearDrafts() {
    setClearingDrafts(true);
    try {
      await clearAllGeneratedDrafts();
      await loadGeneratedDrafts();
    } finally {
      setClearingDrafts(false);
      setClearDraftsConfirmOpen(false);
    }
  }

  const rows = table?.rows ?? [];
  const columns = table?.columns ?? [];

  // Best-effort column name detection - the real Salesforce export's exact header text can
  // vary slightly (e.g. "Case Comment" vs "Case Comments"), so this matches loosely rather
  // than assuming one exact string, to avoid a brittle "works today, breaks on next export"
  // failure mode.
  //
  // FIX: findColumn accepts an optional excludeCandidates list - confirmed via a standalone
  // test that without it, searching for "comment" could silently match "Case Comment
  // Created Date" instead of the actual comment-text column, if the export's real column
  // order ever happened to list the date column first. The comment-text search below
  // explicitly excludes anything also matching "created date"/"created", making the match
  // correct regardless of column order.
  function findColumn(candidates, excludeCandidates = []) {
    return columns.find((col) => {
      const lower = col.toLowerCase();
      const matches = candidates.some((c) => lower.includes(c.toLowerCase()));
      if (!matches) return false;
      const excluded = excludeCandidates.some((c) => lower.includes(c.toLowerCase()));
      return !excluded;
    });
  }
  const caseNumberCol = findColumn(["case number"]);
  const siteIdCol = findColumn(["enlighten site id", "site id"]);
  // FIX (confirmed real bug): these were previously resolved by a SINGLE findColumn(["o&m
  // status", "status"]) call, which -- since findColumn() searches COLUMNS in order, not
  // candidates in order -- could resolve to whichever of the two real columns happened to
  // appear FIRST in the export, not necessarily "O&M Status". This was confirmed live: case
  // tiles were showing generic Status values ("Closed", "Needs Review", "Case - In
  // Progress") in their status badge, not real O&M Status values, meaning statusCol had
  // been resolving to the generic "Status" column all along. Filtering by a real O&M
  // Status value ("Quote Requested") against that wrong column's data matched zero rows.
  // Now resolved as two GENUINELY SEPARATE columns: omStatusCol strictly matches only
  // "o&m status"; statusCol matches "status" while explicitly EXCLUDING "o&m status" (since
  // "O&M Status" itself contains the substring "status" and would otherwise still match).
  const omStatusCol = findColumn(["o&m status"]);
  const statusCol = findColumn(["status"], ["o&m status"]);
  const commentCol = findColumn(["case comment", "comment"], ["created date", "created"]);
  const createdCol = findColumn(["case comment created date", "created date"]);

  // Only cases matching ALL THREE of these are ever shown here, per explicit request:
  //   1. O&M Status is exactly "Quote Requested" (case-sensitive, exact -- never a
  //      partial/fuzzy match, so e.g. "Quote Requested - Follow Up" would NOT qualify).
  //   2. The case's (generic) Status is anything OTHER than "Closed" (case-insensitive,
  //      since this is a coarser, less strictly-defined field than O&M Status).
  //   3. The case comment contains "O&M_QUOTE" or "Estimated Onsite Labor Hours" -- a
  //      genuine quote-request payload marker, confirmed present in a real imported case's
  //      comment text (see parseQuoteRequestCase.js's own header comment for the full
  //      confirmed structure).
  // Each condition independently falls back to "pass" (does not filter on it) if its
  // underlying column could not be detected at all -- so a genuinely malformed/renamed
  // export column never silently hides every case with no way to tell why.
  const QUALIFYING_OM_STATUS = "Quote Requested";
  const QUALIFYING_COMMENT_MARKERS = ["O&M_QUOTE", "Estimated Onsite Labor Hours"];
  const qualifyingRows = rows.filter((row) => {
    const matchesOmStatus = omStatusCol
      ? String(row[omStatusCol] ?? "").trim() === QUALIFYING_OM_STATUS
      : true;
    const isNotClosed = statusCol
      ? String(row[statusCol] ?? "").trim().toLowerCase() !== "closed"
      : true;
    const hasQualifyingMarker = commentCol
      ? QUALIFYING_COMMENT_MARKERS.some((marker) => String(row[commentCol] ?? "").includes(marker))
      : true;
    return matchesOmStatus && isNotClosed && hasQualifyingMarker;
  });

  // FIX (confirmed real cause, via direct inspection of the imported data file): a
  // React "duplicate key" warning was traced to genuine, expected source data -- the
  // Salesforce export includes ONE ROW PER CASE COMMENT, not one row per case, so any
  // case with more than one comment (e.g. an internal note added after the original
  // quote-request comment) produces multiple rows sharing the same Case Number. This is
  // not a data-corruption bug; it is normal comment history. To show exactly ONE tile per
  // case (never a React key collision, never a confusing duplicate tile), rows sharing a
  // case number are collapsed to the single MOST RECENT one, using Case Comment Created
  // Date when available (falling back to array order if that column can't be detected or
  // parsed). If two comments for the same case have genuinely different underlying
  // Case Comment text (not just different author/timestamp metadata), the older one's
  // content is still discarded here in favor of the most recent -- consistent with
  // treating the latest comment as the authoritative version of a case's quote request.
  const dedupedQualifyingRows = caseNumberCol
    ? (() => {
        const byCaseNumber = new Map();
        qualifyingRows.forEach((row, originalIndex) => {
          const key = row[caseNumberCol];
          if (key === undefined || key === null || key === "") {
            // No case number at all -- can't dedupe meaningfully, always keep.
            byCaseNumber.set(`__no-case-number-${originalIndex}__`, row);
            return;
          }
          const existing = byCaseNumber.get(key);
          if (!existing) {
            byCaseNumber.set(key, row);
            return;
          }
          if (!createdCol) return; // no way to compare recency -- keep the first one seen
          const existingTime = new Date(existing[createdCol]).getTime();
          const candidateTime = new Date(row[createdCol]).getTime();
          if (!Number.isNaN(candidateTime) && (Number.isNaN(existingTime) || candidateTime > existingTime)) {
            byCaseNumber.set(key, row);
          }
        });
        return Array.from(byCaseNumber.values());
      })()
    : qualifyingRows;

  const term = search.trim().toLowerCase();
  const filteredRows = term
    ? dedupedQualifyingRows.filter((row) =>
        columns.some((col) => String(row[col] ?? "").toLowerCase().includes(term))
      )
    : dedupedQualifyingRows;

  if (selectedCaseNumber) {
    const selectedRecord = generatedDraftsByCase[selectedCaseNumber] || null;
    return (
      <AutoDrafterDraftDetails
        record={selectedRecord}
        caseNumber={selectedCaseNumber}
        onBack={() => setSelectedCaseNumber(null)}
        onRecordUpdated={(updatedRecord) => {
          setGeneratedDraftsByCase((prev) => ({ ...prev, [selectedCaseNumber]: updatedRecord }));
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              Auto-Drafter
              <Badge variant="outline" className="text-xs font-medium text-violet-600 border-violet-300">
                beta
              </Badge>
            </h1>
            <p className="text-muted-foreground mt-1">Import new quote requests from Salesforce for review.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <SalesforceImportButton
              reportType={REPORT_TYPE}
              reportLabel={REPORT_LABEL}
              onImported={handleImported}
              getSavedUrl={getSalesforceReportUrl}
              setSavedUrl={setSalesforceReportUrl}
            />
            <Button variant="outline" className="border-slate-300" onClick={() => setImportDialogOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Import File
            </Button>
            {Object.keys(generatedDraftsByCase).length > 0 && (
              <Button
                variant="outline"
                className="border-rose-200 text-rose-600 hover:bg-rose-50"
                onClick={() => setClearDraftsConfirmOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Generated Drafts
              </Button>
            )}
            {table && (
              <Button
                variant="outline"
                className="border-rose-200 text-rose-600 hover:bg-rose-50"
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Data
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6 border-border">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search cases..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </Card>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
        ) : !table ? (
          <Card className="p-12 text-center border-border">
            <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No data imported yet</h3>
            <p className="text-muted-foreground">
              Use "Salesforce" for one-click import, or "Import File" to upload a CSV/Excel export manually.
            </p>
          </Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-4">
              {dedupedQualifyingRows.length} case{dedupedQualifyingRows.length === 1 ? "" : "s"} awaiting a quote draft - imported {table.importedAt ? new Date(table.importedAt).toLocaleString() : "unknown time"}
              {table.sourceFileName ? ` from ${table.sourceFileName}` : ""}
            </p>

            {filteredRows.length === 0 ? (
              <Card className="p-12 text-center border-border">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No cases found</h3>
                <p className="text-muted-foreground">
                  {search
                    ? "Try adjusting your search"
                    : "No cases currently match the Auto-Drafter criteria (O&M Status \"Quote Requested\", case not closed, and a quote request detected in the comments)"}
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredRows.map((row, idx) => {
                  const caseNumberValue = caseNumberCol ? row[caseNumberCol] : null;
                  return (
                    <AutoDrafterCaseTile
                      key={caseNumberValue ?? idx}
                      row={row}
                      index={idx}
                      caseNumberCol={caseNumberCol}
                      siteIdCol={siteIdCol}
                      statusCol={statusCol}
                      commentCol={commentCol}
                      createdCol={createdCol}
                      reportType={REPORT_TYPE}
                      savedDraftRecord={caseNumberValue ? generatedDraftsByCase[caseNumberValue] || null : null}
                      onDraftSaved={() => loadGeneratedDrafts()}
                      onViewDraft={() => setSelectedCaseNumber(caseNumberValue)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        <ImportAsTableDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          reportType={REPORT_TYPE}
          reportLabel={REPORT_LABEL}
          onImported={handleImported}
        />

        <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear "{REPORT_LABEL}" data?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every imported case currently shown here, so a fresh
                import can start clean. This cannot be undone - you will need to re-import the
                report to bring the data back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmClear}
                disabled={clearing}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {clearing ? "Clearing..." : "Clear Data"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={clearDraftsConfirmOpen} onOpenChange={setClearDraftsConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all generated drafts?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every saved "AI Generated Quote - Needs Review" draft
                shown here, so cases return to their raw, not-yet-drafted state. This cannot be
                undone - you will need to click "Generate Draft" again for each case. Drafts
                already sent to Quotes are real Quote records and are NOT affected by this.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearingDrafts}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmClearDrafts}
                disabled={clearingDrafts}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {clearingDrafts ? "Clearing..." : "Clear Generated Drafts"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}