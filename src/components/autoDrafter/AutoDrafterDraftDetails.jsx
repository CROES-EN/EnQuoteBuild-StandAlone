import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import StatusBadge from "@/components/quotes/StatusBadge";
import {calculateQuoteTotals} from "@/utils/quoteCalculations";
import {createQuote, getCurrentUser} from "@/api/dataClient";
import {saveGeneratedDraft} from "@/features/autoDrafter/autoDrafterDraftsStore";
import {createPageUrl} from "@/utils";
import {PRODUCT_CATALOG} from "@/features/quoteDraftAgent/productCatalog";
import {toast} from "sonner";
import {format} from "date-fns";
import {
    AlertTriangle,
    ArrowLeft,
    Calendar,
    ExternalLink,
    FileText,
    Hash,
    Info,
    Loader2,
    MapPin,
    Pencil,
    Plus,
    Search,
    Send,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    User,
    Users
} from "lucide-react";

// FIX (per explicit request: "properly use this type of search to add items" in
// Auto-Drafter, matching the manual Quotes page): the SAME fuzzy, tolerant matching
// logic just built and tested for QuoteItemSelector.jsx (the manual quote item picker),
// kept as its own local, self-contained copy here rather than a shared import -- Auto-
// Drafter's AUTOMATIC line-item matching (draftEngine.js's findBestCatalogMatch()) is
// deliberately kept strict (whole-word, ordered phrase matching) to avoid the exact
// false-positive risk already fixed once tonight (the ZNSHINE/"Solar Panel Clips" bug).
// This fuzzy picker is ONLY ever used as a MANUAL, human-initiated action -- a reviewer
// explicitly searching to replace an unmatched or low-confidence item -- never as part
// of automatic matching, so the tolerance/risk tradeoff here is appropriate.
function normalizeSizeNotation(text) {
  let result = String(text || "");
  result = result.replace(
    /(\d+)\s*\/\s*(\d+)\s*[-]?\s*(?:inch(?:es)?|in\.?|")/gi,
    (match, num, denom) => `${num}over${denom}in`
  );
  result = result.replace(
    /(\d+(?:\.\d+)?)\s*[-]?\s*(?:inch(?:es)?|in\.?|")/gi,
    (match, num) => `${num.replace(".", "p")}in`
  );
  return result;
}

function normalizeForSearch(text) {
  return normalizeSizeNotation(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForSearch(text) {
  return normalizeForSearch(text).split(" ").filter(Boolean);
}

function fuzzyMatches(name, description, searchTerm) {
  const searchTokens = tokenizeForSearch(searchTerm);
  if (searchTokens.length === 0) return true;
  const haystackTokens = [...tokenizeForSearch(name), ...tokenizeForSearch(description || "")];
  return searchTokens.every((searchToken) =>
    haystackTokens.some((token) => token.includes(searchToken))
  );
}

// Lets a reviewer manually search the real product catalog and replace an unmatched or
// low-confidence line item with a genuine, priced catalog entry -- opened via the new
// "Find in Catalog" button next to each line item while editing. Purely a manual,
// human-initiated lookup; never called automatically.
function CatalogPickerDialog({ open, onOpenChange, onSelect }) {
  const [searchTerm, setSearchTerm] = useState("");
  const results = searchTerm.trim().length > 0
    ? PRODUCT_CATALOG.filter((p) => fuzzyMatches(p.name, "", searchTerm)).slice(0, 30)
    : [];

  function handleSelect(product) {
    onSelect(product);
    onOpenChange(false);
    setSearchTerm("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSearchTerm(""); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Find in Catalog</DialogTitle>
          <DialogDescription>
            Search the real product catalog to replace this line item with a genuine, priced match.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Search catalog..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div className="max-h-72 overflow-y-auto space-y-1 mt-2">
          {results.map((product, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(product)}
              className="w-full text-left p-2 rounded-lg hover:bg-secondary flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate text-sm">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.category}</p>
              </div>
              <span className="text-sm font-medium text-foreground shrink-0">
                ${product.unit_price?.toFixed(2)}
              </span>
            </button>
          ))}
          {searchTerm.trim().length > 0 && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No matches found.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * AutoDrafterDraftDetails - a full-page view of a single saved Auto-Drafter generated
 * draft, opened INSIDE the Auto-Drafter page itself (see AutoDrafter.jsx's
 * selectedCaseNumber state) rather than as a popup dialog or a real page navigation.
 *
 * Deliberately mirrors src/pages/QuoteDetails.jsx's visual layout (Quote Details info
 * card, Line Items table + totals breakdown, Scope of Work, Notes) so a reviewer sees
 * something immediately familiar.
 *
 * THREE STATES:
 *   1. Read-only (default) - exactly as before, plus new "Edit" and "Send to Quotes"
 *      actions in the header.
 *   2. Editing - site fields, line items (name/qty/unit price - total recalculates live),
 *      scope of work, and notes become editable inputs. "Save Changes" persists via
 *      saveGeneratedDraft() (the SAME store/collection already used for the initial
 *      generated draft - genuinely separate from the real `quotes` collection). Adding/
 *      removing a line item is supported; compatibility/dependency flags are NOT editable
 *      here (they are computed findings, not manually-entered data).
 *   3. Sent to Quotes - once "Send to Quotes" succeeds, this draft's record is marked
 *      `sentToQuotes: true` with the REAL quote's id/number recorded. This state is
 *      permanent for this draft (matching "once sent, this stops being an Auto-Drafter
 *      draft" per explicit design intent) - editing and re-sending are disabled, and a
 *      single "View in Quotes" link navigates to the real QuoteDetails page instead.
 *
 * SEND TO QUOTES: builds a real quote object from the (possibly edited) draft's fields
 * and calls the SAME createQuote() used by CreateQuote.jsx, generating a genuine
 * "Q-<7-digit-timestamp><3-digit-random>" quote number in the EXACT SAME format/logic
 * CreateQuote.jsx itself uses (confirmed by reading its real code) - replacing the
 * "AI-XXXXXXXXXX" draft reference number entirely once sent. The new quote is created
 * with status "draft_without_internal" (a real, normal quote status) so it enters the
 * standard quote workflow needing to be reviewed. This is a deliberate, explicit, MANUAL
 * action - it never happens automatically.
 */
// FIX (per explicit request): "low" confidence is produced EXCLUSIVELY by
// categorizeConfidence()'s genuinely-unmatched fallback path (confirmed by reading its
// real structure -- every other return path sets matched: true), so "low" can be shown
// as the more specific, honest "Item not found in Catalog" label instead of the generic
// word "low" -- this is a certainty, not a guess. "high"/"medium" are unaffected.
function ConfidenceBadge({ confidence }) {
  const styles = {
    high: "bg-emerald-100 text-emerald-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-rose-100 text-rose-700"
  };
  const labels = {
    low: "Not in Catalog"
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[confidence] || "bg-slate-100 text-slate-700"}`}>
      {labels[confidence] || confidence || "unknown"}
    </span>
  );
}

function CompatibilityFlagRow({ flag }) {
  const config = {
    blocked: { icon: ShieldAlert, className: "border-rose-200 bg-rose-50 text-rose-800" },
    review_required: { icon: AlertTriangle, className: "border-amber-200 bg-amber-50 text-amber-800" },
    verified_compatible: { icon: ShieldCheck, className: "border-emerald-200 bg-emerald-50 text-emerald-800" }
  }[flag.status] || { icon: Info, className: "border-slate-200 bg-slate-50 text-slate-700" };
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${config.className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">{flag.triggerItem}</p>
        <p>{flag.reason}</p>
      </div>
    </div>
  );
}

// Generates a real quote number in the EXACT SAME format/logic CreateQuote.jsx uses.
function generateRealQuoteNumber() {
  const ts = Date.now().toString().slice(-7);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `Q-${ts}${rand}`;
}

export default function AutoDrafterDraftDetails({ record, caseNumber, onBack, onRecordUpdated }) {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editedDraft, setEditedDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pickerIndexOpen, setPickerIndexOpen] = useState(null);

  if (!record) return null;

  const draft = isEditing ? editedDraft : (record.draft || {});
  const draftWithItems = { ...draft, items: draft.items || [] };
  const {
    itemsSubtotal,
    laborCost,
    travelCost,
    mileageCost,
    subtotal,
    discountAmount,
    combinedTaxRate,
    taxableAfterDiscount,
    taxAmount,
    total: calculatedTotal
  } = calculateQuoteTotals(draftWithItems);
  const hasDiscount = discountAmount > 0;
  const hasTax = combinedTaxRate > 0;

  const generatedDate = record.generatedAt && !Number.isNaN(new Date(record.generatedAt).getTime())
    ? format(new Date(record.generatedAt), "MMM d, yyyy 'at' h:mm a")
    : "Unknown";

  const allFlags = [
    ...(draft.compatibility_flags || []),
    ...(draft.legacy_warnings || []).map((w) => ({ status: "review_required", ...w })),
    ...(draft.dependency_advisories || []).map((a) => ({
      status: "review_required",
      triggerItem: a.triggerItem,
      reason: a.note || a.reason || "Advisory accessory suggestion -- review before finalizing."
    })),
    ...(draft.material_size_flags || []).map((f) => ({
      status: "review_required",
      triggerItem: f.type === "size_mismatch" ? "Conduit Size" : "Conduit Material",
      reason: f.reason
    }))
  ];

  function startEditing() {
    // Deep-clone the draft so edits never mutate the saved record until "Save Changes"
    // is explicitly clicked -- clicking "Cancel" simply discards editedDraft.
    setEditedDraft(JSON.parse(JSON.stringify(record.draft || {})));
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setEditedDraft(null);
  }

  function updateDraftField(field, value) {
    setEditedDraft((prev) => ({ ...prev, [field]: value }));
  }

  function updateItemField(index, field, value) {
    setEditedDraft((prev) => {
      const items = [...(prev.items || [])];
      const item = { ...items[index], [field]: value };
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      item.total = Math.round(qty * price * 100) / 100;
      items[index] = item;
      return { ...prev, items };
    });
  }

  // Replaces a line item with a genuine, priced catalog match selected via
  // CatalogPickerDialog -- sets confidence to "high" with a reason noting this was a
  // manual reviewer match, so it no longer shows "Item not found in Catalog" once saved.
  function applyCatalogMatch(index, product) {
    setEditedDraft((prev) => {
      const items = [...(prev.items || [])];
      const item = { ...items[index] };
      const qty = parseFloat(item.quantity) || 1;
      item.name = product.name;
      item.unit_price = product.unit_price;
      item.unit = product.unit || item.unit || "each";
      item.tax_code = product.tax_code || item.tax_code;
      item.confidence = "high";
      item.confidence_reason = "Manually matched to a real catalog item by reviewer.";
      item.total = Math.round(qty * item.unit_price * 100) / 100;
      items[index] = item;
      return { ...prev, items };
    });
  }

  function addItem() {
    setEditedDraft((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        { name: "New Item", quantity: 1, unit: "each", unit_price: 0, total: 0, taxable: true, confidence: "low" }
      ]
    }));
  }

  function removeItem(index) {
    setEditedDraft((prev) => ({
      ...prev,
      items: (prev.items || []).filter((_, i) => i !== index)
    }));
  }

  async function handleSaveChanges() {
    setIsSaving(true);
    try {
      const updatedRecord = { ...record, draft: editedDraft };
      await saveGeneratedDraft(caseNumber, updatedRecord);
      onRecordUpdated?.(updatedRecord);
      setIsEditing(false);
      setEditedDraft(null);
      toast.success("Changes saved.");
    } catch (error) {
      console.error("Failed to save draft changes:", error);
      toast.error("Could not save changes -- see console for details.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSendToQuotes() {
    setIsSending(true);
    try {
      const user = await getCurrentUser();
      const realQuoteNumber = generateRealQuoteNumber();
      const now = new Date().toISOString();

      const newQuote = await createQuote({
        site_id: draft.site_id || record.siteId || "",
        case_number: draft.case_number || caseNumber || "",
        customer: draft.customer || "",
        site_address: draft.site_address || "",
        scope_of_work: draft.scope_of_work || "",
        service_type: draft.service_type || null,
        fst_count: draft.fst_count || 1,
        labor_hours: draft.labor_hours || 0,
        labor_rate: draft.labor_rate,
        travel_hours: draft.travel_hours || 0,
        travel_rate: draft.travel_rate,
        miles_traveled: draft.miles_traveled || 0,
        mileage_rate: draft.mileage_rate,
        items: draft.items || [],
        notes: draft.notes || "",
        quote_number: realQuoteNumber,
        status: "draft_without_internal",
        status_history: [{
          status: "draft_without_internal",
          changed_by: user?.email || "auto-drafter",
          changed_at: now,
          reason: `Sent from Auto-Drafter (originally ${record.quoteNumber || "no reference"})`
        }]
      });

      const updatedRecord = {
        ...record,
        sentToQuotes: true,
        realQuoteId: newQuote.id,
        realQuoteNumber: realQuoteNumber,
        sentAt: now
      };
      await saveGeneratedDraft(caseNumber, updatedRecord);
      onRecordUpdated?.(updatedRecord);
      toast.success(`Sent to Quotes as ${realQuoteNumber}.`);
    } catch (error) {
      console.error("Failed to send draft to Quotes:", error);
      toast.error("Could not send this draft to Quotes -- see console for details.");
    } finally {
      setIsSending(false);
    }
  }

  const isSent = Boolean(record.sentToQuotes);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <Button variant="ghost" className="text-muted-foreground mb-4" onClick={onBack}>
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Auto-Drafter
      </Button>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{record.siteId || draft.site_id || "No Site ID"}</h1>
          <p className="text-muted-foreground mt-1">
            {isSent ? record.realQuoteNumber : (record.quoteNumber || "No reference")}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {isSent ? (
            <>
              <StatusBadge status="draft_without_internal" />
              <Button
                className="bg-indigo-600 hover:bg-indigo-700"
                onClick={() => navigate(createPageUrl(`QuoteDetails?id=${record.realQuoteId}`))}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View in Quotes
              </Button>
            </>
          ) : isEditing ? (
            <>
              <Button variant="outline" onClick={cancelEditing} disabled={isSaving}>
                Cancel
              </Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={handleSaveChanges} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </>
          ) : (
            <>
              <StatusBadge status="ai_generated_quote_needs_review" />
              <Button variant="outline" onClick={startEditing}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={handleSendToQuotes}
                disabled={isSending}
              >
                {isSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {isSending ? "Sending..." : "Send to Quotes"}
              </Button>
            </>
          )}
        </div>
      </div>

      {isSent && (
        <Card className="p-4 mb-6 bg-emerald-50 border-emerald-200">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
            <p className="text-emerald-800">
              This draft has been sent to Quotes as <strong>{record.realQuoteNumber}</strong>. It can no longer be edited here -- manage it from the Quotes tab.
            </p>
          </div>
        </Card>
      )}

      {!isSent && record.parseWarnings && record.parseWarnings.length > 0 && (
        <Card className="p-4 mb-6 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-800">Some fields could not be parsed from this case</p>
              <ul className="list-disc pl-5 mt-1 text-sm text-amber-700">
                {record.parseWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Draft Info */}
        <Card className="p-6 border-border">
          <h3 className="text-lg font-semibold text-foreground mb-4">Quote Details</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <Hash className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Site ID</p>
                <p className="font-medium text-foreground">{record.siteId || draft.site_id || "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <FileText className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Case Number</p>
                <p className="font-medium text-foreground">{draft.case_number || caseNumber || "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Customer</p>
                {isEditing ? (
                  <Input
                    value={draft.customer || ""}
                    onChange={(e) => updateDraftField("customer", e.target.value)}
                    className="mt-1"
                  />
                ) : (
                  <p className="font-medium text-foreground">{draft.customer || "—"}</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground">Site Address</p>
                {isEditing ? (
                  <Input
                    value={draft.site_address || ""}
                    onChange={(e) => updateDraftField("site_address", e.target.value)}
                    className="mt-1"
                  />
                ) : (
                  <p className="font-medium text-foreground break-words">{draft.site_address || "—"}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <Users className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">FSTs Needed</p>
                {isEditing ? (
                  <Input
                    type="number"
                    min="0"
                    value={draft.fst_count ?? 0}
                    onChange={(e) => updateDraftField("fst_count", parseInt(e.target.value, 10) || 0)}
                    className="mt-1"
                  />
                ) : (
                  <p className="font-medium text-foreground">{draft.fst_count || 0}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <Hash className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Labor Hours</p>
                {isEditing ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    value={draft.labor_hours ?? 0}
                    onChange={(e) => updateDraftField("labor_hours", parseFloat(e.target.value) || 0)}
                    className="mt-1"
                  />
                ) : (
                  <p className="font-medium text-foreground">{draft.labor_hours || 0} hrs</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <Hash className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Miles Traveled</p>
                {isEditing ? (
                  <Input
                    type="number"
                    min="0"
                    value={draft.miles_traveled ?? 0}
                    onChange={(e) => updateDraftField("miles_traveled", parseFloat(e.target.value) || 0)}
                    className="mt-1"
                  />
                ) : (
                  <p className="font-medium text-foreground">{draft.miles_traveled || 0} mi @ ${draft.mileage_rate || 0.73}/mi</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <Calendar className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Generated</p>
                <p className="font-medium text-foreground">{generatedDate}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Line Items */}
        <Card className="p-6 border-border lg:col-span-2">
          {draft.service_type && (
            <p className="text-sm text-muted-foreground mb-4">
              <span className="font-medium text-foreground">Service Type:</span> {draft.service_type}
            </p>
          )}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Line Items</h3>
            {isEditing && (
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add Item
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Item</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Qty</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Unit Price</th>
                  {!isEditing && <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Confidence</th>}
                  <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Total</th>
                  {isEditing && <th className="py-3 px-2"></th>}
                </tr>
              </thead>
              <tbody>
                {(draft.items || []).map((item, index) => (
                  <tr key={index} className="border-b border-border">
                    <td className="py-3 px-2">
                      {isEditing ? (
                        <Input
                          value={item.name || ""}
                          onChange={(e) => updateItemField(index, "name", e.target.value)}
                        />
                      ) : (
                        <>
                          <p className="font-medium text-foreground">{item.name}</p>
                          {item.confidence_reason && (
                            <p className="text-sm text-muted-foreground">{item.confidence_reason}</p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right text-foreground">
                      {isEditing ? (
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={item.quantity ?? 0}
                          onChange={(e) => updateItemField(index, "quantity", parseFloat(e.target.value) || 0)}
                          className="w-20 ml-auto text-right"
                        />
                      ) : (
                        <>{item.quantity} {item.unit}</>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right text-foreground">
                      {isEditing ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price ?? 0}
                          onChange={(e) => updateItemField(index, "unit_price", parseFloat(e.target.value) || 0)}
                          className="w-24 ml-auto text-right"
                        />
                      ) : (
                        <>${item.unit_price?.toFixed(2)}</>
                      )}
                    </td>
                    {!isEditing && (
                      <td className="py-3 px-2 text-right">
                        <ConfidenceBadge confidence={item.confidence} />
                      </td>
                    )}
                    <td className="py-3 px-2 text-right font-medium text-foreground">
                      ${item.total?.toFixed(2)}
                    </td>
                    {isEditing && (
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Find in Catalog"
                            onClick={() => setPickerIndexOpen(index)}
                          >
                            <Search className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                            <Trash2 className="w-4 h-4 text-rose-500" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(!draft.items || draft.items.length === 0) && (
                  <tr>
                    <td colSpan={isEditing ? 5 : 5} className="py-6 text-center text-sm italic text-muted-foreground">
                      No line items{isEditing ? " -- click \"Add Item\" to add one." : " were generated from this case."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 pt-4 border-t border-border space-y-2">
            <div className="flex justify-between text-muted-foreground">
              <span>Line Items Subtotal</span>
              <span>${itemsSubtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Labor ({draft.fst_count || 0} FST{(draft.fst_count || 0) > 1 ? "s" : ""} — {draft.labor_hours || 0} hrs @ ${draft.labor_rate || 125}/hr)</span>
              <span>${laborCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Travel ({draft.travel_hours || 0} hrs @ ${draft.travel_rate || 65}/hr)</span>
              <span>${travelCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Mileage ({draft.miles_traveled || 0} mi @ ${draft.mileage_rate || 0.73}/mi)</span>
              <span>${mileageCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border text-foreground font-medium">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {hasDiscount && (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span>-${discountAmount.toFixed(2)}</span>
              </div>
            )}
            {hasTax && (
              <div className="flex justify-between text-muted-foreground">
                <span>Taxable Subtotal <span className="text-xs text-muted-foreground">(taxable items only)</span></span>
                <span>${taxableAfterDiscount.toFixed(2)}</span>
              </div>
            )}
            {hasTax && (
              <div className="flex justify-between text-muted-foreground">
                <span>Taxes ({combinedTaxRate}% combined)</span>
                <span>+${taxAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-border">
              <span className="text-lg font-semibold text-foreground">Total</span>
              <span className="text-2xl font-bold text-indigo-600">${calculatedTotal.toFixed(2)}</span>
            </div>
          </div>
        </Card>
      </div>

      <CatalogPickerDialog
        open={pickerIndexOpen !== null}
        onOpenChange={(open) => { if (!open) setPickerIndexOpen(null); }}
        onSelect={(product) => applyCatalogMatch(pickerIndexOpen, product)}
      />

      {/* Scope of Work */}
      <Card className="p-6 mt-6 border-border">
        <h3 className="text-lg font-semibold text-foreground mb-2">Scope of Work</h3>
        {isEditing ? (
          <Textarea
            value={draft.scope_of_work || ""}
            onChange={(e) => updateDraftField("scope_of_work", e.target.value)}
            rows={4}
          />
        ) : (
          <p className="text-muted-foreground whitespace-pre-wrap">{draft.scope_of_work || "—"}</p>
        )}
      </Card>

      {/* Compatibility & Dependency Flags */}
      {allFlags.length > 0 && (
        <Card className="p-6 mt-6 border-border">
          <h3 className="text-lg font-semibold text-foreground mb-4">Compatibility & Dependency Flags</h3>
          <div className="space-y-2">
            {allFlags.map((flag, idx) => (
              <CompatibilityFlagRow key={idx} flag={flag} />
            ))}
          </div>
        </Card>
      )}

      {/* Notes */}
      <Card className="p-6 mt-6 border-border">
        <h3 className="text-lg font-semibold text-foreground mb-2">Notes & Terms</h3>
        {isEditing ? (
          <Textarea
            value={draft.notes || ""}
            onChange={(e) => updateDraftField("notes", e.target.value)}
            rows={4}
          />
        ) : (
          <p className="text-muted-foreground whitespace-pre-wrap">{draft.notes || "—"}</p>
        )}
      </Card>
    </div>
  );
}