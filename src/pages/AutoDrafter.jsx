import {useCallback, useEffect, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {APP_LINK_QUERY} from "../../shared/appLinkRules.js";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {toast} from "sonner";
import {useAuth} from "@/lib/AuthContext";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import PanelRmaRequestDialog from "@/components/rma/PanelRmaRequestDialog";
import RMAList from "@/components/rma/RMAList";
import {rmaCaseKey} from "@/features/rma/rmaRecords";
import {classifyQuoteRequest, requestCategoryCounts} from "@/features/autoDrafter/requestClassification";
import {alternateRequestType, preferQuoteRequestComment, quoteRequestCommentEvidence} from "@/features/quoteRequestIntake/quoteRequestComment";
import AlternateRequestList from "@/components/autoDrafter/AlternateRequestList";
import {automaticSourceInputCorrection} from "@/features/autoDrafter/sourceInputCorrections";
import {DEVICE_CATEGORY_AVERAGES, placeholderUnitPrice} from "@/features/quoteDraftAgent/draftEngine";
import {assessQuoteRequestHygiene, quoteRequestReportColumns} from "@/features/autoDrafter/quoteRequestHygiene";
import QuoteRequestHygieneReview from "@/components/autoDrafter/QuoteRequestHygieneReview";
import {HYGIENE_QUERY_KEY} from "@/features/autoDrafter/useQuoteRequestHygieneReport";
import {useRequestCareEligibility} from "@/features/autoDrafter/useRequestCareEligibility";
import {getEligibilityFromIndex} from "@/features/supervisorDashboard/careEligibility";
import {useAutomaticDraftGeneration} from "@/features/autoDrafter/useAutomaticDraftGeneration";
import {reviewCaseKey} from "@/features/autoDrafter/caseKey";
import {goldenQuoteEvaluations, requestSnapshot} from "@/features/goldenQuotes/goldenQuotes";
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
import {Archive, Download, FileText, Search, Sparkles, Trash2, Undo2, Upload} from "lucide-react";
import {autoDrafterExportFileName, buildAutoDrafterWorkbook} from "@/features/autoDrafter/autoDrafterWorkbookExport";
import {useCaseIdIndex} from "@/features/links/caseIdIndexCache";
import {deleteReportTable, getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import {
  AUTO_DRAFTER_REMOVAL_REASONS,
  clearAllGeneratedDrafts,
  listGeneratedDrafts,
  removalReasonLabel,
  removeCaseFromAutoDrafter,
  restoreCaseToAutoDrafter,
  saveGeneratedDraft
} from "@/features/autoDrafter/autoDrafterDraftsStore";
import {Textarea} from "@/components/ui/textarea";
import {loadLearnedSwaps} from "@/features/quoteDraftAgent/learnedSwapsStore";
import ImportAsTableDialog from "@/components/supervisor/ImportAsTableDialog";
import SalesforceImportButton from "@/components/supervisor/SalesforceImportButton";
import {
  getSalesforceReportUrl,
  setSalesforceReportUrl
} from "@/features/quoteRequestIntake/autoDrafterSalesforceSettings";
import AutoDrafterCaseTile from "@/components/autoDrafter/AutoDrafterCaseTile";
import AutoDrafterDraftDetails from "@/components/autoDrafter/AutoDrafterDraftDetails";
import {getQuotes, listLocalCollection} from "@/api/dataClient";

// Case numbers match even when a spreadsheet dropped leading zeros or a "#" prefix.
const quoteCaseKey = value => reviewCaseKey(value).replace(/^#\s*/, "").replace(/^0+(?=\d)/, "");

const REPORT_TYPE = "quoteRequestCases";
const REPORT_LABEL = "Quote Request Cases";

export const AutoDrafter = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const shareCase = searchParams.get("shareCase");
    const draftCase = searchParams.get("draftCase");
    const {user} = useAuth();
    const queryClient = useQueryClient();
    const careQuery = useRequestCareEligibility();
    const caseIdIndex = useCaseIdIndex();
    const [exporting, setExporting] = useState(false);
    const [requestType, setRequestType] = useState("all");
    const [hygieneOpen, setHygieneOpen] = useState(false);
    const [view, setView] = useState("requests");
    const showPanelRmas = view === "panel-rmas";
    const showGolden = view === "golden";
    const showAlternate = view === "alternate";
    const showRemoved = view === "removed";
    const [removeTarget, setRemoveTarget] = useState(null);
    const [removeReason, setRemoveReason] = useState("quote_not_needed");
    const [removeNote, setRemoveNote] = useState("");
    const [removing, setRemoving] = useState(false);
    const [restoringCase, setRestoringCase] = useState("");
    const [panelRmaTarget, setPanelRmaTarget] = useState(null);
    const panelRmasQuery = useQuery({queryKey: ["pvPanelRMAs"], queryFn: () => listLocalCollection("rmas")});
    const panelRmas = (panelRmasQuery.data || []).filter(record => record.source_category === "panel_rma");
    function openPanelRma(caseNumber, siteId, notes = "") {
        setPanelRmaTarget({caseNumber, siteId, notes});
    }
    const panelRmaDialog = panelRmaTarget && <PanelRmaRequestDialog key={panelRmaTarget.caseNumber}
        target={panelRmaTarget} onClose={() => setPanelRmaTarget(null)} />;
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
    const [draftsLoading, setDraftsLoading] = useState(true);
    const [draftsError, setDraftsError] = useState("");
    const [quotesLoaded, setQuotesLoaded] = useState(false);
    const [quotesLoadError, setQuotesLoadError] = useState("");
    const [automaticDraftsEnabled, setAutomaticDraftsEnabled] = useState(true);
    const [selectedCaseNumber, setSelectedCaseNumber] = useState(null);
    const [existingQuoteCaseNumbers, setExistingQuoteCaseNumbers] = useState(new Set());
    const [allQuotes, setAllQuotes] = useState([]);
    useEffect(() => {
        if (!shareCase && !draftCase) return;
        setSelectedCaseNumber(draftCase || null);
        setSearch("");
        setView("requests");
    }, [shareCase, draftCase]);
    function backToTiles() {
        setSelectedCaseNumber(null);
        setSearchParams(previous => {
            const next = new URLSearchParams(previous);
            next.delete("draftCase");
            next.delete(APP_LINK_QUERY);
            return next;
        }, {replace: true});
    }

    const loadTable = useCallback(async ({showSpinner} = {}) => {
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
            await loadLearnedSwaps();
            const all = await listGeneratedDrafts();
            const byCase = {};
            for (const record of all) {
                byCase[record.caseNumber ?? record.id] = record;
            }
            setGeneratedDraftsByCase(byCase);
            setDraftsError("");
        } catch (error) {
            console.error("Failed to load saved Auto-Drafter drafts:", error);
            toast.error("Unable to load saved Auto-Drafter quotes.");
            setDraftsError(error.message);
        } finally {
            setDraftsLoading(false);
        }
    }, []);

    // Fetches every REAL quote ONE TIME (same "load once at the parent, index it" pattern
    // as loadGeneratedDrafts above, for the exact same OOM-crash-prevention reason) and
    // builds a Set of every case_number that already has a real quote - per explicit
    // request: once a case has been turned into an actual quote (in ANY status - draft,
    // approved, rejected, etc. all count, since the case has already been handled either
    // way), it should stop appearing in Auto-Drafter's "awaiting a quote draft" grid
    // entirely. Matched trimmed/lowercased on both sides so formatting differences
    // between the Salesforce export's Case Number column and a real quote's own
    // case_number field never cause a false "no match".
    const loadExistingQuoteCaseNumbers = useCallback(async () => {
        try {
            const quotes = await getQuotes();
            const caseNumbers = new Set(
                (quotes || [])
                    .map((quote) => quoteCaseKey(quote.case_number))
                    .filter(Boolean)
            );
            setExistingQuoteCaseNumbers(caseNumbers);
            setAllQuotes(quotes || []);
            setQuotesLoadError("");
            setQuotesLoaded(true);
        } catch (error) {
            console.error("Failed to load existing quote case numbers:", error);
            setQuotesLoadError(error.message);
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
        loadExistingQuoteCaseNumbers();
        lastRefreshRef.current = Date.now();

        function refreshIfDue() {
            const now = Date.now();
            if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
            lastRefreshRef.current = now;
            loadTable({showSpinner: true});
            loadGeneratedDrafts();
            loadExistingQuoteCaseNumbers();
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
    }, [loadTable, loadGeneratedDrafts, loadExistingQuoteCaseNumbers]);

    function handleImported() {
        loadTable({showSpinner: true});
        setAutomaticDraftsEnabled(true);
        queryClient.invalidateQueries({queryKey: HYGIENE_QUERY_KEY});
        queryClient.invalidateQueries({queryKey: ["report-tables-for-ops-overview"]});
    }

    async function handleConfirmClear() {
        setClearing(true);
        try {
            await automaticDrafts.stop();
            await deleteReportTable(REPORT_TYPE);
            await loadTable({showSpinner: true});
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
        setAutomaticDraftsEnabled(false);
        setClearingDrafts(true);
        try {
            await automaticDrafts.stop();
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
    // Excludes "O&M Status", which also contains "status".
    const statusCol = findColumn(["status"], ["o&m status"]);
    const commentCol = findColumn(["case comment", "comment"], ["created date", "created"]);
    const createdCol = findColumn(["case comment created date", "created date"]);

    // O&M_CARE_CANCELLATION / O&M_ESCALATION / O&M_RETURN comments are not quote requests.
    // Cases with only those (plus plain notes) move to Alternate Requests; a case that also
    // has a real quote request stays in Quote Requests and appears in both.
    const alternateTypeByRow = new Map(commentCol ? rows.map(row => [row, alternateRequestType(row[commentCol])])
        .filter(([, type]) => type) : []);
    const caseKeyOf = row => caseNumberCol ? reviewCaseKey(row[caseNumberCol]) : "";
    const alternateCaseKeys = new Set([...alternateTypeByRow.keys()].map(caseKeyOf).filter(Boolean));
    const quoteRequestCaseKeys = new Set(alternateCaseKeys.size && commentCol ? rows
        .filter(row => !alternateTypeByRow.has(row) && quoteRequestCommentEvidence(row[commentCol]).hasRequest)
        .map(caseKeyOf).filter(Boolean) : []);
    const quoteRows = rows.filter(row => !alternateTypeByRow.has(row) &&
        !(alternateCaseKeys.has(caseKeyOf(row)) && !quoteRequestCaseKeys.has(caseKeyOf(row))));
    const alternateEntries = (() => {
        const byKey = new Map();
        alternateTypeByRow.forEach((type, row) => {
            const key = `${caseKeyOf(row) || `row-${byKey.size}`}|${type.value}`;
            const existing = byKey.get(key);
            if (!existing || preferQuoteRequestComment(row[commentCol], existing.row[commentCol], row[createdCol], existing.row[createdCol])) {
                byKey.set(key, {row, type});
            }
        });
        const authorCol = findColumn(["case comment created by", "comment created by"]);
        const omStatusCol = findColumn(["o&m status"]);
        return [...byKey.entries()].map(([key, {row, type}]) => ({
            key, type, row,
            caseNumber: caseNumberCol ? String(row[caseNumberCol] ?? "").trim() : "",
            siteId: siteIdCol ? String(row[siteIdCol] ?? "").trim() : "",
            comment: String(row[commentCol] || ""),
            created: createdCol ? String(row[createdCol] ?? "").trim() : "",
            author: authorCol ? String(row[authorCol] ?? "").trim() : "",
            status: [statusCol && row[statusCol], omStatusCol && row[omStatusCol]].filter(Boolean).join(" · ")
        })).sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0));
    })();

    // Salesforce exports one row per comment. Prefer requests over later notes,
    // then the newest request revision.
    const dedupedQualifyingRows = caseNumberCol
        ? (() => {
        const byCaseNumber = new Map();
        quoteRows.forEach((row, originalIndex) => {
            const key = reviewCaseKey(row[caseNumberCol]);
            if (!key) {
                // No case number at all -- can't dedupe meaningfully, always keep.
                byCaseNumber.set(`__no-case-number-${originalIndex}__`, row);
                return;
            }
            const existing = byCaseNumber.get(key);
            if (!existing) {
                byCaseNumber.set(key, row);
                return;
            }
            if (preferQuoteRequestComment(row[commentCol], existing[commentCol], row[createdCol], existing[createdCol])) {
                byCaseNumber.set(key, row);
            }
        });
        return Array.from(byCaseNumber.values());
          })()
        : quoteRows;

    // A case that already has a real EnQuote quote (Q-###, any status) is hidden and never auto-drafted.
    const hasRealQuote = row => existingQuoteCaseNumbers.has(quoteCaseKey(row[caseNumberCol]));
    // Cases moved out manually (quote not needed, Panel RMA filed...) are hidden until restored.
    const removedRecords = Object.values(generatedDraftsByCase).filter(record => record.removedFromAutoDrafter)
        .sort((a, b) => String(b.removedFromAutoDrafter.removedAt || "").localeCompare(String(a.removedFromAutoDrafter.removedAt || "")));
    const removedCaseKeys = new Set(removedRecords.map(record => quoteCaseKey(record.caseNumber ?? record.id)));
    const awaitingRows = caseNumberCol ? dedupedQualifyingRows.filter(row => !hasRealQuote(row) &&
        !removedCaseKeys.has(quoteCaseKey(row[caseNumberCol]))) : dedupedQualifyingRows;
    const automaticDrafts = useAutomaticDraftGeneration({
        ownerEmail: user?.email,
        candidates: awaitingRows.map(row => ({
            caseNumber: String(row[caseNumberCol] || "").trim(),
            siteId: String(row[siteIdCol] || "").trim(),
            comment: String(row[commentCol] || "")
        })),
        enabled: automaticDraftsEnabled && Boolean(user?.email) && !loading && !draftsLoading && !draftsError &&
            quotesLoaded && !quotesLoadError && !clearing && !clearingDrafts,
        onSaved: record => setGeneratedDraftsByCase(previous => ({...previous, [record.caseNumber ?? record.id]: record}))
    });
    const savedDraftsByCaseKey = new Map(Object.values(generatedDraftsByCase).map(record => [reviewCaseKey(record.caseNumber ?? record.id), record]));
    const classificationsByRow = new Map(awaitingRows.map(row => [row,
        classifyQuoteRequest(commentCol ? row[commentCol] : "",
            savedDraftsByCaseKey.get(reviewCaseKey(row[caseNumberCol]))?.draft?.items || [])]));
    const hygieneColumns = quoteRequestReportColumns(columns);
    const categoryCounts = requestCategoryCounts(classificationsByRow.values());
    const typeRows = awaitingRows.filter(row => requestType === "all" || classificationsByRow.get(row).type === requestType);
    const goldenEvaluations = goldenQuoteEvaluations(Object.values(generatedDraftsByCase), allQuotes);
    const goldenRecords = [...goldenEvaluations.byCase.values()].filter(evaluation => evaluation.golden)
        .map(evaluation => evaluation.record)
        .filter(record => !search.trim() || [record.caseNumber, record.siteId, record.realQuoteNumber]
            .some(value => String(value || "").toLowerCase().includes(search.trim().toLowerCase())))
        .sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || "")));
    function latestSourceRow(caseNumber) {
        return rows.filter(row => reviewCaseKey(row[caseNumberCol]) === reviewCaseKey(caseNumber))
            .reduce((previous, row) => !previous || preferQuoteRequestComment(row[commentCol], previous[commentCol],
                row[createdCol], previous[createdCol]) ? row : previous, null);
    }
    // Quotes sent before Golden Quotes existed have no recorded SOP check; capture it once from the report.
    const snapshotTargets = table && caseNumberCol && commentCol ? Object.values(generatedDraftsByCase)
        .filter(record => record.sentToQuotes && !record.requestSnapshot)
        .map(record => ({record, row: latestSourceRow(record.caseNumber ?? record.id)}))
        .filter(target => target.row) : [];
    const snapshotKey = snapshotTargets.map(target => target.record.caseNumber ?? target.record.id).join("|");
    const snapshotTargetsRef = useRef(snapshotTargets);
    snapshotTargetsRef.current = snapshotTargets;
    useEffect(() => {
        if (!snapshotKey) return;
        let cancelled = false;
        (async () => {
            for (const {record, row} of snapshotTargetsRef.current) {
                if (cancelled) return;
                const comment = String(row[commentCol] || "");
                const updated = {...record, requestSnapshot: requestSnapshot(classifyQuoteRequest(comment, record.draft?.items || []),
                    assessQuoteRequestHygiene(row, quoteRequestReportColumns(columns)))};
                try {
                    await saveGeneratedDraft(record.caseNumber ?? record.id, updated);
                    if (!cancelled) setGeneratedDraftsByCase(previous => ({...previous, [record.caseNumber ?? record.id]: updated}));
                } catch (error) {
                    console.error(`Could not record the Golden Quote SOP check for case ${record.caseNumber}:`, error);
                }
            }
        })();
        return () => {cancelled = true;};
    }, [snapshotKey]);
    // Unsent, unedited drafts saved with joined range digits (e.g. "16-24" as 1624 hours) are
    // corrected to the request's upper bound once, so tiles and totals stop showing them.
    const correctionTargets = draftsLoading ? [] : Object.values(generatedDraftsByCase).map(record => {
        const row = table && caseNumberCol && commentCol ? latestSourceRow(record.caseNumber ?? record.id) : null;
        return automaticSourceInputCorrection(record, row ? String(row[commentCol] || "") : record.sourceComment, {placeholderPrice: placeholderUnitPrice, categoryAverages: DEVICE_CATEGORY_AVERAGES});
    }).filter(Boolean);
    const correctionKey = correctionTargets.map(record => `${record.caseNumber ?? record.id}:${record.inputCorrections.at(-1).changes.join(",")}`).join("|");
    const correctionTargetsRef = useRef(correctionTargets);
    correctionTargetsRef.current = correctionTargets;
    useEffect(() => {
        if (!correctionKey) return;
        let cancelled = false;
        (async () => {
            for (const updated of correctionTargetsRef.current) {
                if (cancelled) return;
                const key = updated.caseNumber ?? updated.id;
                try {
                    await saveGeneratedDraft(key, updated);
                    if (!cancelled) setGeneratedDraftsByCase(previous => ({...previous, [key]: updated}));
                } catch (error) {
                    console.error(`Could not correct the saved draft for case ${key}:`, error);
                }
            }
        })();
        return () => {cancelled = true;};
    }, [correctionKey]);
    function openRemoveCase(caseNumber, siteId) {
        setRemoveReason("quote_not_needed");
        setRemoveNote("");
        setRemoveTarget({caseNumber, siteId});
    }
    async function confirmRemoveCase() {
        if (!removeTarget) return;
        setRemoving(true);
        try {
            const record = await removeCaseFromAutoDrafter(removeTarget.caseNumber, {
                reason: removeReason, note: removeNote, removedBy: user?.email, siteId: removeTarget.siteId
            });
            setGeneratedDraftsByCase(previous => {
                const next = {...previous};
                for (const key of Object.keys(next)) if (reviewCaseKey(key) === reviewCaseKey(record.caseNumber)) delete next[key];
                return {...next, [record.caseNumber]: record};
            });
            toast.success(`Case ${removeTarget.caseNumber} moved out of Auto-Drafter (${removalReasonLabel(removeReason)}).`);
            setRemoveTarget(null);
        } catch (error) {
            toast.error(error.message || "Could not remove the case.");
        } finally {
            setRemoving(false);
        }
    }
    async function restoreCase(record) {
        const key = String(record.caseNumber ?? record.id);
        setRestoringCase(key);
        try {
            const restored = await restoreCaseToAutoDrafter(key);
            setGeneratedDraftsByCase(previous => {
                const next = {...previous};
                for (const existingKey of Object.keys(next)) if (reviewCaseKey(existingKey) === reviewCaseKey(key)) delete next[existingKey];
                return restored ? {...next, [restored.caseNumber]: restored} : next;
            });
            toast.success(`Case ${key} is back in Auto-Drafter.`);
        } catch (error) {
            toast.error(error.message || "Could not restore the case.");
        } finally {
            setRestoringCase("");
        }
    }
    const term = search.trim().toLowerCase();
    const filteredRows = term
        ? typeRows.filter((row) =>
            columns.some((col) => String(row[col] ?? "").toLowerCase().includes(term))
        )
        : typeRows;
    async function exportWorkbook() {
        setExporting(true);
        try {
            await writeExportWorkbook();
        } catch (error) {
            toast.error(`Could not export: ${error?.message || error}`);
        } finally {
            setExporting(false);
        }
    }
    async function writeExportWorkbook() {
        // Read saved drafts at export time so the workbook never depends on page state that is
        // still loading (an export taken mid-load listed every case as "Not drafted").
        let draftsByKey = savedDraftsByCaseKey;
        try {
            const saved = await listGeneratedDrafts();
            draftsByKey = new Map([...savedDraftsByCaseKey,
                ...saved.map(record => [reviewCaseKey(record.caseNumber ?? record.id), record])]);
        } catch (error) {
            console.error("Export is using the drafts already loaded on the page:", error);
        }
        const skippedByCase = new Map(automaticDrafts.skipped.map(item => [reviewCaseKey(item.caseNumber), item.reason]));
        const golden = goldenQuoteEvaluations([...draftsByKey.values()], allQuotes);
        const entries = filteredRows.map(row => {
            const caseNumber = caseNumberCol ? String(row[caseNumberCol] ?? "").trim() : "";
            const draftRecord = caseNumber ? draftsByKey.get(reviewCaseKey(caseNumber)) || null : null;
            const siteId = siteIdCol ? String(row[siteIdCol] ?? "").trim() : "";
            return {
                caseNumber, siteId, draftRecord,
                comment: commentCol ? String(row[commentCol] || "") : "",
                classification: classificationsByRow.get(row),
                hygiene: assessQuoteRequestHygiene(row, hygieneColumns),
                hasRealQuote: Boolean(caseNumberCol) && hasRealQuote(row),
                golden: draftRecord?.sentToQuotes ? Boolean(golden.byCase.get(reviewCaseKey(caseNumber))?.golden) : null,
                careEligibility: !careQuery.isError && careQuery.data ? getEligibilityFromIndex(siteId, careQuery.data) : null,
                careError: careQuery.isError,
                panelRma: (panelRmasQuery.data || []).find(record => rmaCaseKey(record.case_id) === rmaCaseKey(caseNumber)) || null,
                skippedReason: skippedByCase.get(reviewCaseKey(caseNumber)) || ""
            };
        });
        const categoryLabel = requestType === "all" ? "all" : categoryCounts.find(option => option.value === requestType)?.label;
        const {default: ExcelJS} = await import("exceljs");
        const workbook = buildAutoDrafterWorkbook(ExcelJS, entries, {caseIndex: caseIdIndex});
        const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()],
            {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
        const link = document.createElement("a");
        link.href = url;
        link.download = autoDrafterExportFileName(categoryLabel);
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success(`Exported ${entries.length} case${entries.length === 1 ? "" : "s"} to Excel.`);
    }
    const hygieneDialog =  <Dialog open={hygieneOpen} onOpenChange={setHygieneOpen}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Quote Request Data Hygiene</DialogTitle>
                <DialogDescription>Automatic checks of the latest report. Verify the requester and findings before follow-up.</DialogDescription>
            </DialogHeader>
            <QuoteRequestHygieneReview table={table} />
        </DialogContent>
    </Dialog>;

    if (selectedCaseNumber) {
        const selectedRecord = savedDraftsByCaseKey.get(reviewCaseKey(selectedCaseNumber)) || null;
        if (!selectedRecord) {
            return <Card className="m-6 p-6 space-y-3" role={draftsLoading ? "status" : "alert"}>
                <p>{draftsLoading ? "Loading saved Auto-Drafter quote..." : "This saved Auto-Drafter quote is no longer available."}</p>
                <Button variant="outline" onClick={backToTiles}>Back to Auto-Drafter</Button>
            </Card>;
        }
        const sourceRow = latestSourceRow(selectedCaseNumber);
        const sourceComment = sourceRow && commentCol ? String(sourceRow[commentCol] || "") : selectedRecord.sourceComment || "";
        const classification = classifyQuoteRequest(sourceComment, selectedRecord.draft?.items || []);
        return (
            <>
            <AutoDrafterDraftDetails
                record={selectedRecord}
                sourceComment={sourceComment}
                classification={classification}
                hygiene={sourceRow ? assessQuoteRequestHygiene(sourceRow, hygieneColumns) : null}
                careEligibility={!careQuery.isError && careQuery.data ? getEligibilityFromIndex(selectedRecord.siteId, careQuery.data) : null}
                careError={careQuery.isError ? careQuery.error : null}
                onRetryCare={() => careQuery.refetch()}
                onPanelRma={() => openPanelRma(selectedCaseNumber, selectedRecord.siteId)}
                onHygieneReview={() => setHygieneOpen(true)}
                caseNumber={selectedCaseNumber}
                onBack={backToTiles}
                onRecordUpdated={(updatedRecord) => {
                    setGeneratedDraftsByCase((prev) => ({...prev, [selectedCaseNumber]: updatedRecord}));
                }}
            />
            {panelRmaDialog}
            {hygieneDialog}
            </>
        );
    }

    return (
        <div className="min-h-screen bg-background" data-enquote-share-scope="tiles">
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
                        <p className="text-muted-foreground mt-1">Import new quote requests from Salesforce for
                            review.</p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <SalesforceImportButton
                            reportType={REPORT_TYPE}
                            reportLabel={REPORT_LABEL}
                            onImported={handleImported}
                            getSavedUrl={getSalesforceReportUrl}
                            setSavedUrl={setSalesforceReportUrl}
                        />
                        <Button variant="outline" size="sm" disabled={!table} onClick={() => setHygieneOpen(true)}>Data Hygiene</Button>
                        {view === "requests" && <Button variant="outline" size="sm" data-auto-drafter-export
                            disabled={!table || filteredRows.length === 0 || exporting || draftsLoading} onClick={exportWorkbook}
                            title="Export the cases currently shown to Excel (category and search filters apply)">
                            <Download className="w-4 h-4 mr-2"/>
                            {exporting ? "Exporting…" : draftsLoading ? "Loading drafts…" : `Export Excel (${table ? filteredRows.length : 0})`}
                        </Button>}
                        <Button variant="outline" className="border-slate-300"
                                onClick={() => setImportDialogOpen(true)}>
                            <Upload className="w-4 h-4 mr-2"/>
                            Import File
                        </Button>
                        {Object.values(generatedDraftsByCase).some(record => record.draft || !record.removedFromAutoDrafter) && (
                            <Button
                                variant="outline"
                                className="border-rose-200 text-rose-600 hover:bg-rose-50"
                                onClick={() => setClearDraftsConfirmOpen(true)}
                            >
                                <Trash2 className="w-4 h-4 mr-2"/>
                                Clear Generated Drafts
                            </Button>
                        )}
                        {table && (
                            <Button
                                variant="outline"
                                className="border-rose-200 text-rose-600 hover:bg-rose-50"
                                onClick={() => setClearConfirmOpen(true)}
                            >
                                <Trash2 className="w-4 h-4 mr-2"/>
                                Clear Data
                            </Button>
                        )}
                    </div>
                </div>

                {/* Filters */}
                <Card className="p-4 mb-6 border-border">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex items-center gap-3">
                            <label htmlFor="request-view-filter" className="text-sm font-medium">View</label>
                            <Select value={view} onValueChange={setView}>
                                <SelectTrigger id="request-view-filter" aria-label="Select request view" className="w-64"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="requests">Quote Requests ({awaitingRows.length})</SelectItem>
                                    <SelectItem value="golden">Golden Quotes ({[...goldenEvaluations.byCase.values()].filter(evaluation => evaluation.golden).length})</SelectItem>
                                    <SelectItem value="panel-rmas">Panel RMA Requests ({panelRmas.length})</SelectItem>
                                    <SelectItem value="alternate">Alternate Requests ({alternateEntries.length})</SelectItem>
                                    <SelectItem value="removed">Removed Cases ({removedRecords.length})</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
                            <Input
                                placeholder="Search cases..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    </div>
                    {view === "requests" && <div className="mt-4 border-t pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                        <label htmlFor="request-type-filter" className="text-sm font-medium shrink-0">Case category</label>
                        <Select value={requestType} onValueChange={setRequestType}>
                            <SelectTrigger id="request-type-filter" aria-label="Filter by request type" className="sm:w-80"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All request types ({awaitingRows.length})</SelectItem>
                                {categoryCounts.map(option => <SelectItem key={option.value} value={option.value}>
                                    {option.label} ({option.count})
                                </SelectItem>)}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Based on requested work, not installed equipment. Each case is in exactly one category; review concerns appear as flags in tile Details. Unclassified means the requested work could not be identified.</p>
                    </div>}
                </Card>

                <Card className="p-3 mb-4 text-sm space-y-2">
                    <p>{!automaticDraftsEnabled ? "Automatic drafting paused after clearing drafts." : automaticDrafts.busy
                        ? `Generating review drafts automatically... ${automaticDrafts.created} ready.`
                        : "Eligible requests generate review drafts automatically. Saved drafts are never overwritten; Send to Quotes remains manual."}</p>
                    {!automaticDraftsEnabled && <Button size="sm" variant="outline" onClick={() => setAutomaticDraftsEnabled(true)}>Resume automatic drafting</Button>}
                    {automaticDrafts.skipped.length > 0 && <details><summary className="cursor-pointer">{automaticDrafts.skipped.length} requests need more details before automatic drafting</summary>
                        <ul className="list-disc pl-5">{automaticDrafts.skipped.map((item, index) => <li key={index}>Case {item.caseNumber || "missing"}: {item.reason}</li>)}</ul>
                    </details>}
                    {automaticDrafts.errors.length > 0 && <div role="alert" className="text-destructive">
                        <p>Some review drafts could not be generated:</p>
                        <ul className="list-disc pl-5">{automaticDrafts.errors.map((item, index) => <li key={index}>Case {item.caseNumber}: {item.reason}</li>)}</ul>
                        <Button size="sm" variant="outline" disabled={automaticDrafts.busy} onClick={automaticDrafts.retry}>Retry automatic drafts</Button>
                    </div>}
                    {(draftsError || quotesLoadError) && <div role="alert" className="text-destructive">
                        Automatic drafting paused: {draftsError || quotesLoadError}
                        <Button size="sm" variant="outline" onClick={() => {loadGeneratedDrafts(); loadExistingQuoteCaseNumbers();}}>Retry draft prerequisites</Button>
                    </div>}
                </Card>
                {careQuery.isError && <p role="alert" className="mb-3 text-destructive">Could not verify Care subscriptions: {careQuery.error.message}. Care routing is unverified.
                    <button className="underline ml-2" onClick={() => careQuery.refetch()}>Retry Care verification</button>
                </p>}
                {panelRmasQuery.isError && <p role="alert" className="mb-3 text-destructive">Could not load Panel RMA links: {panelRmasQuery.error.message} <button className="underline" onClick={() => panelRmasQuery.refetch()}>Retry</button></p>}
                {showRemoved ? (
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">Cases moved out of Auto-Drafter are not drafted automatically. Restore a case to bring it back to Quote Requests.</p>
                        {(() => {
                            const shown = removedRecords.filter(record => !term || [record.caseNumber, record.siteId,
                                record.removedFromAutoDrafter.note, removalReasonLabel(record.removedFromAutoDrafter.reason)]
                                .some(value => String(value || "").toLowerCase().includes(term)));
                            if (!shown.length) return <Card className="p-12 text-center border-border">
                                <Archive className="w-12 h-12 text-slate-300 mx-auto mb-4"/>
                                <h3 className="text-lg font-semibold text-foreground mb-2">No removed cases</h3>
                                <p className="text-muted-foreground">{term ? "Try adjusting your search" : "Use Remove on a case tile to move it out of Auto-Drafter."}</p>
                            </Card>;
                            return <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {shown.map(record => {
                                    const key = String(record.caseNumber ?? record.id);
                                    const removal = record.removedFromAutoDrafter;
                                    const removedAt = removal.removedAt && !Number.isNaN(new Date(removal.removedAt).getTime())
                                        ? new Date(removal.removedAt).toLocaleString() : "Unknown time";
                                    return <Card key={key} data-removed-case={key} className="p-5 space-y-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <h3 className="font-semibold">Case #{key}</h3>
                                                <p className="text-sm text-muted-foreground">{record.siteId ? `Site ${record.siteId}` : "No site ID"}</p>
                                            </div>
                                            <Badge variant="secondary">{removalReasonLabel(removal.reason)}</Badge>
                                        </div>
                                        {removal.note && <p className="text-sm whitespace-pre-wrap">{removal.note}</p>}
                                        <p className="text-xs text-muted-foreground">Removed {removedAt}{removal.removedBy ? ` by ${removal.removedBy}` : ""}{record.draft ? " ? Review draft kept" : ""}</p>
                                        <Button size="sm" variant="outline" className="w-full" disabled={restoringCase === key}
                                            data-restore-case={key} onClick={() => restoreCase(record)}>
                                            <Undo2 className="w-4 h-4 mr-2"/>{restoringCase === key ? "Restoring..." : "Restore to Auto-Drafter"}
                                        </Button>
                                    </Card>;
                                })}
                            </div>;
                        })()}
                    </div>
                ) : showAlternate ? (
                    !table ? <p className="py-8 text-center text-sm text-muted-foreground">{loading ? "Loading..." : "Import the Salesforce report to see alternate requests."}</p>
                        : <AlternateRequestList entries={alternateEntries.filter(entry => !term ||
                            [entry.caseNumber, entry.siteId, entry.author, entry.comment].some(value => value.toLowerCase().includes(term)))} />
                ) : showPanelRmas ? (
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">Panel RMA tracker entries are separate from quote drafting. Additional quotes for wiring or catalog materials remain available.</p>
                        <RMAList rmas={panelRmas.filter(record => !search || [record.case_id, record.site_id, record.panel_manufacturer].some(value => String(value || "").toLowerCase().includes(search.toLowerCase())))}
                            isLoading={panelRmasQuery.isLoading} onEdit={record => openPanelRma(record.case_id, record.site_id)} />
                    </div>
                ) : showGolden ? (
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">Golden Quotes followed the SOP perfectly: the request had zero Data Hygiene flags, was eligible (not pure Panel RMA, Enphase RMA or LPUP/TPUP), was sent without draft edits, and was approved without rejection or later edits.</p>
                        {goldenRecords.length === 0 ? <Card className="p-12 text-center border-border">
                            <Sparkles className="w-12 h-12 text-amber-400 mx-auto mb-4"/>
                            <h3 className="text-lg font-semibold text-foreground mb-2">No Golden Quotes yet</h3>
                            <p className="text-muted-foreground">{search ? "Try adjusting your search" : "Approved quotes that meet every SOP check appear here."}</p>
                        </Card> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {goldenRecords.map((record, idx) => {
                                const caseNumberValue = String(record.caseNumber ?? record.id);
                                const sourceRow = latestSourceRow(caseNumberValue);
                                const comment = sourceRow && commentCol ? String(sourceRow[commentCol] || "") : record.sourceComment || "";
                                return <AutoDrafterCaseTile key={caseNumberValue} index={idx} golden={goldenEvaluations.byCase.get(reviewCaseKey(caseNumberValue))}
                                    row={{caseNumber: caseNumberValue, siteId: record.siteId || "", comment}}
                                    caseNumberCol="caseNumber" siteIdCol="siteId" commentCol="comment" reportType={REPORT_TYPE}
                                    savedDraftRecord={record} onViewDraft={() => setSelectedCaseNumber(caseNumberValue)}
                                    classification={classifyQuoteRequest(comment, record.draft?.items || [])}
                                    careEligibility={!careQuery.isError && careQuery.data ? getEligibilityFromIndex(record.siteId, careQuery.data) : null} />;
                            })}
                        </div>}
                    </div>
                ) : loading ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
                ) : !table ? (
                    <Card className="p-12 text-center border-border">
                        <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4"/>
                        <h3 className="text-lg font-semibold text-foreground mb-2">No data imported yet</h3>
                        <p className="text-muted-foreground">
                            Use "Salesforce" for one-click import, or "Import File" to upload a CSV/Excel export
                            manually.
                        </p>
                    </Card>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground mb-4">
                            {typeRows.length} case{typeRows.length === 1 ? "" : "s"} in the report matching the selected request type
                            {term ? ` (${filteredRows.length} shown by search)` : ""} -
                            imported {table.importedAt ? new Date(table.importedAt).toLocaleString() : "unknown time"}
                            {table.sourceFileName ? ` from ${table.sourceFileName}` : ""}
                        </p>

                        {filteredRows.length === 0 ? (
                            <Card className="p-12 text-center border-border">
                                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4"/>
                                <h3 className="text-lg font-semibold text-foreground mb-2">No cases found</h3>
                                <p className="text-muted-foreground">
                                    {search
                                        ? "Try adjusting your search"
                                        : "No cases match the selected request type."}
                                </p>
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {filteredRows.map((row, idx) => {
                                    const caseNumberValue = caseNumberCol ? String(row[caseNumberCol] ?? "").trim() : null;
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
                                            savedDraftRecord={caseNumberValue ? savedDraftsByCaseKey.get(reviewCaseKey(caseNumberValue)) || null : null}
                                            onDraftSaved={() => loadGeneratedDrafts()}
                                            onViewDraft={() => setSelectedCaseNumber(caseNumberValue)}
                                            onPanelRma={() => openPanelRma(caseNumberValue, siteIdCol ? row[siteIdCol] : "", commentCol ? String(row[commentCol] || "") : "")}
                                            onRemove={caseNumberValue ? () => openRemoveCase(caseNumberValue, siteIdCol ? String(row[siteIdCol] ?? "").trim() : "") : undefined}
                                            panelRma={(panelRmasQuery.data || []).find(record => rmaCaseKey(record.case_id) === rmaCaseKey(caseNumberValue))}
                                            classification={classificationsByRow.get(row)}
                                            hygiene={assessQuoteRequestHygiene(row, hygieneColumns)}
                                            automaticDrafting
                                            careEligibility={!careQuery.isError && careQuery.data ? getEligibilityFromIndex(siteIdCol ? row[siteIdCol] : "", careQuery.data) : null}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}

                {panelRmaDialog}
                {hygieneDialog}
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

                <Dialog open={Boolean(removeTarget)} onOpenChange={open => {if (!open && !removing) setRemoveTarget(null);}}>
                    <DialogContent className="max-w-md" data-remove-case-dialog>
                        <DialogHeader>
                            <DialogTitle>Remove case {removeTarget?.caseNumber} from Auto-Drafter?</DialogTitle>
                            <DialogDescription>The case stops appearing in Quote Requests and is not drafted automatically. Any review draft is kept. Restore it any time from Removed Cases.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <label htmlFor="remove-case-reason" className="text-sm font-medium">Reason</label>
                                <Select value={removeReason} onValueChange={setRemoveReason}>
                                    <SelectTrigger id="remove-case-reason" aria-label="Removal reason"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {AUTO_DRAFTER_REMOVAL_REASONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="remove-case-note" className="text-sm font-medium">Note {removeReason === "other" ? "(required)" : "(optional)"}</label>
                                <Textarea id="remove-case-note" value={removeNote} onChange={event => setRemoveNote(event.target.value)}
                                    placeholder={removeReason === "panel_rma_filed" ? "e.g. RMA emailed to the manufacturer" : "Why this case does not need a quote"} />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" disabled={removing} onClick={() => setRemoveTarget(null)}>Cancel</Button>
                                <Button data-confirm-remove-case disabled={removing || (removeReason === "other" && !removeNote.trim())} onClick={confirmRemoveCase}>
                                    {removing ? "Removing..." : "Remove case"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                <AlertDialog open={clearDraftsConfirmOpen} onOpenChange={setClearDraftsConfirmOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Clear all generated drafts?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This permanently deletes every saved "AI Generated Quote - Needs Review" draft
                                shown here, so cases return to their raw, not-yet-drafted state. This cannot be
                                undone - you will need to click "Generate Draft" again for each case. Drafts
                                already sent to Quotes are real Quote records and are NOT affected by this.
                                Removed cases stay removed.
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
};
