import {useState} from "react";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Calendar, ClipboardList, FileText, Loader2, MapPin, Package, Sparkles, User} from "lucide-react";
import {format} from "date-fns";
import {motion} from "framer-motion";
import {toast} from "sonner";
import StatusBadge from "@/components/quotes/StatusBadge";
import {calculateQuoteTotals} from "@/utils/quoteCalculations";
import {parseQuoteRequestCase} from "@/features/autoDrafter/parseQuoteRequestCase";
import {generateQuoteDraft} from "@/features/quoteDraftAgent/draftEngine";
import {saveGeneratedDraft} from "@/features/autoDrafter/autoDrafterDraftsStore";

/**
 * AutoDrafterCaseTile - a quote-page-style tile for a single raw Salesforce case row,
 * used ONLY inside Auto-Drafter (src/pages/AutoDrafter.jsx). Deliberately mirrors the
 * visual structure of src/components/quotes/QuoteCard.jsx (icon avatar + title/subtitle
 * header, status badge top-right, footer divider) so cases look consistent with real
 * quotes - but this is NOT QuoteCard and does NOT navigate anywhere. These are pre-quote
 * case records; no Quote/QuoteDetails record exists for them yet, so there is
 * intentionally no <Link> and no click-through, unlike QuoteCard.
 *
 * Column values (caseNumberCol, siteIdCol, statusCol, commentCol, createdCol) are passed
 * in as the SAME best-effort-detected column names already computed in AutoDrafter.jsx
 * via findColumn() - this component does not re-detect columns itself.
 *
 * The single free-text case comment field (commentCol) contains several labeled
 * sub-fields run together (e.g. "...Customer Name: Jane Doe Site Address: 123 Main St...").
 * extractField() below does a best-effort, label-bounded regex pull for a handful of the
 * most useful ones. This is intentionally forgiving: if a label is missing or the export's
 * phrasing shifts slightly, the field just comes back empty and the tile falls back to
 * showing a plain truncated snippet of the raw comment - it never throws and never invents
 * a value that wasn't in the text.
 *
 * TWO RENDER MODES:
 *   1. No generated draft saved yet for this case -> the original raw-case view below,
 *      plus a "Generate Draft" button.
 *   2. A generated draft IS saved for this case -> renders a tile that looks EXACTLY like
 *      a real QuoteCard.jsx, using the "ai_generated_quote_needs_review" status. Clicking
 *      it calls the `onViewDraft` prop (handled by the parent AutoDrafter.jsx), which
 *      opens a full-page, read-only AutoDrafterDraftDetails view INSIDE the Auto-Drafter
 *      page itself - not a popup dialog, and not a real page navigation, because no real
 *      Quote record is ever created here. Sending a draft to the real Quotes tab is a
 *      deliberate, separate, MANUAL step this component does not perform.
 *
 * FIX (confirmed real OOM crash, reproduced right after clicking "Generate Draft" with
 * ~100+ cases on screen): this component used to independently fetch its own saved draft
 * via a per-tile useEffect + getGeneratedDraftForCase() call. electron/repository.cjs's
 * read() re-parses the ENTIRE shared local data file on every single collections:list call
 * with no caching, so ~100+ simultaneous tile-mount fetches piled up ~100+ full-file
 * parses in memory at once, exhausting the JS heap. The saved draft (if any) is now passed
 * down as the `savedDraftRecord` prop, fetched EXACTLY ONCE by the parent
 * (AutoDrafter.jsx) - this component itself no longer performs any collection reads.
 */
const FIELD_LABELS = [
  "Quote Category",
  "Customer Name",
  "Site Address",
  "Root Cause",
  "Scope Description",
  "Item Name"
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractField(text, label) {
  if (!text) return "";
  const otherLabels = FIELD_LABELS.filter((l) => l !== label).map(escapeRegex).join("|");
  const pattern = new RegExp(
    `${escapeRegex(label)}:\\s*(.*?)(?=\\s*(?:${otherLabels})\\s*:|$)`,
    "i"
  );
  const match = text.match(pattern);
  return match ? match[1].trim().replace(/\s{2,}/g, " ") : "";
}

function truncate(text, max = 110) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

// Generates a draft reference number distinct from real quotes' "Q-XXXXXXXNNN" format
// (see CreateQuote.jsx) so the two are never visually confused with each other, even
// though this tile otherwise looks like a real QuoteCard.
function generateDraftReferenceNumber() {
  const ts = Date.now().toString().slice(-7);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `AI-${ts}${rand}`;
}

export default function AutoDrafterCaseTile({
  row,
  index = 0,
  caseNumberCol,
  siteIdCol,
  statusCol,
  commentCol,
  createdCol,
  savedDraftRecord = null,
  onDraftSaved,
  onViewDraft
}) {
  const comment = commentCol ? row[commentCol] || "" : "";

  const quoteCategory = extractField(comment, "Quote Category");
  const customerName = extractField(comment, "Customer Name");
  const siteAddress = extractField(comment, "Site Address");
  const scopeDescription = extractField(comment, "Scope Description");

  const caseNumber = caseNumberCol ? row[caseNumberCol] : null;
  const siteId = siteIdCol ? row[siteIdCol] : null;
  const status = statusCol ? row[statusCol] : null;
  const createdAt = createdCol ? row[createdCol] : null;

  const hasParsedFields = Boolean(siteAddress || scopeDescription);

  const [isGenerating, setIsGenerating] = useState(false);

  async function handleGenerateDraft() {
    setIsGenerating(true);
    try {
      const { request, parseWarnings } = parseQuoteRequestCase(comment);
      const draft = generateQuoteDraft(request);
      const record = {
        siteId: siteId || draft.site_id || "",
        quoteNumber: generateDraftReferenceNumber(),
        status: "ai_generated_quote_needs_review",
        draft,
        parseWarnings,
        generatedAt: new Date().toISOString()
      };
      await saveGeneratedDraft(caseNumber, record);
      onDraftSaved?.();
      toast.success("Draft generated and saved for review.");
    } catch (error) {
      console.error("Failed to generate draft from case comment:", error);
      toast.error("Could not generate a draft from this case -- see console for details.");
    } finally {
      setIsGenerating(false);
    }
  }

  // --- Mode 2: a draft has already been generated and saved for this case ------------
  if (savedDraftRecord) {
    const { total: calculatedTotal } = calculateQuoteTotals(savedDraftRecord.draft || {});
    const itemCount = savedDraftRecord.draft?.items?.length || 0;
    const generatedDate = savedDraftRecord.generatedAt && !Number.isNaN(new Date(savedDraftRecord.generatedAt).getTime())
      ? format(new Date(savedDraftRecord.generatedAt), "MMM d, yyyy")
      : null;
    // Once sent to Quotes, the tile's reference number and status badge reflect the REAL
    // sent quote (see AutoDrafterDraftDetails.jsx's handleSendToQuotes()) instead of the
    // "AI-XXXXXXXXXX" draft placeholder - clicking still opens the same details view,
    // which itself shows a "View in Quotes" action for a sent draft rather than Edit/Send.
    const isSent = Boolean(savedDraftRecord.sentToQuotes);
    const displayReference = isSent ? savedDraftRecord.realQuoteNumber : savedDraftRecord.quoteNumber;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.03 }}
      >
        <button type="button" className="block w-full text-left" onClick={() => onViewDraft?.()}>
          <Card className="p-5 hover:shadow-lg transition-all duration-300 border-border hover:border-indigo-200 group cursor-pointer h-full flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors shrink-0">
                  <FileText className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground group-hover:text-indigo-600 transition-colors">
                    {savedDraftRecord.siteId || "No Site ID"}
                  </h3>
                  <p className="text-sm text-muted-foreground">{displayReference || "No reference"}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <StatusBadge status={isSent ? "draft_without_internal" : "ai_generated_quote_needs_review"} size="small" />
              </div>
            </div>

            <div className="space-y-2 text-sm flex-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                {generatedDate || "Unknown"}
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {itemCount} item{itemCount !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" />
                  Auto-Drafter
                </span>
              </div>
              <span className="text-lg font-bold text-foreground">
                ${calculatedTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </Card>
        </button>
      </motion.div>
    );
  }

  // --- Mode 1: raw case view, no draft generated yet ---------------------------------
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
    >
      <Card className="p-5 hover:shadow-lg transition-all duration-300 border-border hover:border-violet-200 group h-full flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center group-hover:bg-violet-100 transition-colors shrink-0">
              <FileText className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground group-hover:text-violet-600 transition-colors">
                {customerName || (siteId ? `Site ${siteId}` : "Unknown Customer")}
              </h3>
              <p className="text-sm text-muted-foreground">
                Case #{caseNumber || "No reference"}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {status && (
              <Badge variant="secondary" className="text-xs">
                {status}
              </Badge>
            )}
            {createdAt && (
              <span className="text-xs text-muted-foreground">{createdAt}</span>
            )}
          </div>
        </div>

        <div className="space-y-2 text-sm flex-1">
          {hasParsedFields ? (
            <>
              {siteAddress && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{truncate(siteAddress, 80)}</span>
                </div>
              )}
              {scopeDescription && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <ClipboardList className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{truncate(scopeDescription, 110)}</span>
                </div>
              )}
            </>
          ) : comment ? (
            <p className="text-muted-foreground">{truncate(comment, 160)}</p>
          ) : (
            <p className="text-muted-foreground italic">No case comment text found.</p>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Package className="w-3 h-3" />
            {siteId ? `Site ${siteId}` : "No site ID"}
          </span>
          {quoteCategory && (
            <span className="text-sm font-bold text-foreground">{quoteCategory}</span>
          )}
        </div>

        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={isGenerating || !comment}
            onClick={handleGenerateDraft}
          >
            {isGenerating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Generate Draft
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}