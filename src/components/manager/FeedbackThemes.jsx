import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { updateReview } from "@/api/dataClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Pencil, Check, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Keywords that indicate HO engagement issues — boneyard-type reasons
const HO_ENGAGEMENT_KEYWORDS = [
  "lost communication", "no response", "pending response", "unreachable",
  "homeowner", "ho engagement", "ho contact", "cannot reach", "unresponsive",
  "waiting on ho", "waiting on homeowner", "no contact", "failed contact",
  "communication", "not responding", "no reply", "stopped responding",
];

// Keywords that indicate a review explicitly mentions boneyard
const BONEYARD_TEXT_KEYWORDS = [
  "boneyard", "on hold", "on_hold", "placed on hold", "moved to boneyard",
  "hold pending", "ho decision", "homeowner decision",
];

function isBoneyardHOEngagement(quote) {
  if (!quote) return false;
  if (quote.status === "on_hold") {
    const reason = (quote.hold_reason || "").toLowerCase();
    return HO_ENGAGEMENT_KEYWORDS.some(kw => reason.includes(kw)) || reason.length === 0;
  }
  return false;
}

// Returns true if the review text mentions boneyard AND the quote IS actively on_hold
function shouldAutoBoneyard(review, quote) {
  if (!quote || quote.status !== "on_hold") return false;
  const text = `${review.coaching_notes || ""} ${review.recommended_edits || ""}`.toLowerCase();
  return BONEYARD_TEXT_KEYWORDS.some(kw => text.includes(kw));
}

const THEMES = [
  { label: "Pricing / Rate", keywords: ["price", "pricing", "rate", "cost", "too high", "expensive", "markup"] },
  { label: "Scope Detail", keywords: ["scope", "detail", "description", "incomplete", "vague", "clarif", "unclear"] },
  { label: "Documentation", keywords: ["photo", "evidence", "document", "attachment", "proof", "record", "image"] },
  { label: "Labor Hours", keywords: ["labor", "hours", "time", "duration", "excessive", "hour"] },
  { label: "Parts / Materials", keywords: ["parts", "material", "component", "supply", "equipment", "inventory"] },
  { label: "Travel / Mileage", keywords: ["travel", "mileage", "distance", "trip", "drive"] },
  { label: "Justification", keywords: ["justif", "reason", "explain", "why", "rationale", "warrant"] },
  { label: "Formatting", keywords: ["format", "layout", "structure", "template", "missing field"] },
  { label: "Boneyard", keywords: ["boneyard", "on hold", "on_hold"] },
];

const THEME_LABELS = THEMES.map(t => t.label);

function scoreTheme(text, keywords) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw)).length;
}

function detectTheme(text) {
  if (!text) return null;
  let best = null;
  let bestScore = 0;
  THEMES.forEach(t => {
    const s = scoreTheme(text, t.keywords);
    if (s > bestScore) { bestScore = s; best = t.label; }
  });
  return best;
}

// Quote-level expandable row showing full comment thread
function QuoteCommentThread({ review }) {
  const [open, setOpen] = useState(false);

  // Build a timeline from coaching_notes (single entry) + status_history-style entries if available
  // We treat coaching_notes + recommended_edits as one entry
  const entries = [];
  if (review.coaching_notes || review.recommended_edits) {
    entries.push({
      date: review.completed_date || review.updated_date || review.created_date,
      author: review.reviewer_email,
      coaching: review.coaching_notes,
      edits: review.recommended_edits,
    });
  }
  // Most recent at top
  entries.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-1 py-1.5">
        {/* Secondary expand arrow on left edge */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex-shrink-0 mt-0.5 text-slate-400 hover:text-slate-600 transition-colors"
          title={open ? "Collapse comments" : "Expand comments"}
        >
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/* Quote identifier */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-700 truncate">
            #{review.quote_number || review.quote_id?.slice(0, 8)}
            {review.site_id && <span className="text-slate-400 ml-1">· {review.site_id}</span>}
          </p>
          {!open && review.coaching_notes && (
            <p className="text-xs text-slate-500 truncate mt-0.5">{review.coaching_notes}</p>
          )}
        </div>
      </div>

      {/* Expanded comment thread */}
      {open && (
        <div className="ml-5 mb-2 space-y-2">
          {entries.length === 0 && (
            <p className="text-xs text-slate-400 italic">No feedback comments recorded.</p>
          )}
          {entries.map((entry, i) => (
            <div key={i} className="bg-white rounded border border-slate-100 p-2 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-slate-600">{entry.author || "Unknown"}</span>
                {entry.date && (
                  <span className="text-slate-400">
                    {new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
                {i === 0 && <span className="bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full text-[10px] font-medium">Most Recent</span>}
              </div>
              {entry.coaching && (
                <p className="text-slate-600 leading-relaxed">{entry.coaching}</p>
              )}
              {entry.edits && (
                <p className="text-slate-500 mt-1 italic">Recommended edits: {entry.edits}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline re-categorization widget for a single review
function RecatRow({ review, canEdit, quote }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(review.rejection_driver || "");
  const [useManual, setUseManual] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const save = useMutation({
    mutationFn: (val) => updateReview(review.id, { rejection_driver: val }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manager-reviews"] });
      setEditing(false);
      setUseManual(false);
      setManualValue("");
    },
  });

  const handleSave = () => {
    const val = useManual ? manualValue.trim() : selected;
    if (!val) return;
    save.mutate(val);
  };

  const displayDriver = review.rejection_driver || detectTheme(`${review.coaching_notes || ""} ${review.recommended_edits || ""}`) || "Uncategorized";

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Quote row with left-arrow expand */}
      <div className="flex items-start gap-1 py-1.5">
        <div className="w-3.5 shrink-0" /> {/* spacer to align with QuoteCommentThread */}
        <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-700 truncate">
              #{review.quote_number || review.quote_id?.slice(0, 8)}
              {review.site_id && <span className="text-slate-400 ml-1">· {review.site_id}</span>}
            </p>
            {review.coaching_notes && (
              <p className="text-xs text-slate-500 truncate mt-0.5">{review.coaching_notes}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {editing ? (
              <div className="flex flex-col gap-1.5 items-end">
                {!useManual ? (
                  <>
                    <Select value={selected} onValueChange={setSelected}>
                      <SelectTrigger className="h-6 text-xs w-40">
                        <SelectValue placeholder="Select theme…" />
                      </SelectTrigger>
                      <SelectContent>
                        {THEME_LABELS.map(l => (
                          <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      className="text-[10px] text-blue-500 hover:underline"
                      onClick={() => { setUseManual(true); setManualValue(selected); }}
                    >
                      + type a custom category
                    </button>
                  </>
                ) : (
                  <>
                    <Input
                      value={manualValue}
                      onChange={e => setManualValue(e.target.value)}
                      placeholder="Custom category…"
                      className="h-6 text-xs w-40"
                    />
                    <button
                      className="text-[10px] text-slate-400 hover:underline"
                      onClick={() => setUseManual(false)}
                    >
                      ← use dropdown
                    </button>
                  </>
                )}
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-green-600"
                    disabled={save.isPending || (useManual ? !manualValue.trim() : !selected)}
                    onClick={handleSave}
                  >
                    <Check className="w-3 h-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-slate-400"
                    onClick={() => { setEditing(false); setUseManual(false); setManualValue(""); }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Badge className="text-xs bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
                  {displayDriver}
                </Badge>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-slate-400 hover:text-orange-500"
                    onClick={() => { setSelected(displayDriver); setEditing(true); }}
                    title="Re-categorize"
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FeedbackThemes({ reviews, quotes = [], canEdit = false }) {
  const queryClient = useQueryClient();
  const [expandedTheme, setExpandedTheme] = useState(null);
  const [showBoneyard, setShowBoneyard] = useState(false);

  if (!reviews.length) return <p className="text-sm text-slate-400 py-4">No review feedback yet.</p>;

  // Build quick lookup: quote_id -> quote record
  const quoteMap = {};
  quotes.forEach(q => { quoteMap[q.id] = q; });

  // Auto-boneyard: for any review where text mentions boneyard AND quote is on_hold,
  // treat its theme as "Boneyard" (does not mutate DB — display only unless already set)
  const reviewsWithTheme = reviews
    .filter(r => r.coaching_notes || r.recommended_edits)
    .filter(r => {
      if (showBoneyard) return true;
      const quote = quoteMap[r.quote_id];
      return !isBoneyardHOEngagement(quote);
    })
    .map(r => {
      const quote = quoteMap[r.quote_id];
      // If manually overridden, respect that
      if (r.rejection_driver) return { ...r, _theme: r.rejection_driver };
      // Auto-assign Boneyard if criteria met
      if (shouldAutoBoneyard(r, quote)) return { ...r, _theme: "Boneyard" };
      const text = `${r.coaching_notes || ""} ${r.recommended_edits || ""}`;
      const theme = detectTheme(text) || "Other";
      return { ...r, _theme: theme };
    });

  // Count per theme
  const countMap = {};
  reviewsWithTheme.forEach(r => {
    countMap[r._theme] = (countMap[r._theme] || 0) + 1;
  });

  const topThemes = Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const max = topThemes[0]?.[1] || 1;

  const themeColors = [
    "bg-red-400", "bg-orange-400", "bg-amber-400",
    "bg-yellow-400", "bg-lime-400", "bg-green-400",
  ];

  const boneyardCount = reviews.filter(r => {
    const quote = quoteMap[r.quote_id];
    return isBoneyardHOEngagement(quote) && (r.coaching_notes || r.recommended_edits);
  }).length;

  return (
    <div className="space-y-2">
      {topThemes.map(([label, count], idx) => {
        const isExpanded = expandedTheme === label;
        const linkedReviews = reviewsWithTheme.filter(r => r._theme === label);

        return (
          <div key={label} className="rounded-lg border border-slate-100 overflow-hidden">
            {/* Theme bar row */}
            <button
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
              onClick={() => setExpandedTheme(isExpanded ? null : label)}
            >
              <span className="text-xs text-slate-700 w-32 shrink-0 font-medium">{label}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-2">
                <div
                  className={`${themeColors[idx] || "bg-slate-400"} h-2 rounded-full transition-all`}
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-slate-600 w-6 text-right">{count}</span>
              <span className="text-slate-400 ml-1">
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
            </button>

            {/* Expanded: linked quotes */}
            {isExpanded && (
              <div className="bg-slate-50 border-t border-slate-100 px-3 py-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Related Quotes ({linkedReviews.length})
                  {canEdit && <span className="normal-case font-normal text-slate-400 ml-1">— click <Pencil className="w-3 h-3 inline" /> to re-categorize</span>}
                </p>
                <div>
                  {linkedReviews.map(r => (
                    <QuoteCommentThread key={r.id} review={r} />
                  ))}
                </div>
                {/* Pencil re-cat overlay — separate section below the expand rows */}
                {canEdit && (
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Re-categorize</p>
                    {linkedReviews.map(r => (
                      <RecatRow key={`recat-${r.id}`} review={r} canEdit={canEdit} quote={quoteMap[r.quote_id]} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Boneyard toggle */}
      {canEdit && (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {showBoneyard
              ? "Showing boneyard / HO-engagement quotes"
              : `${boneyardCount} boneyard / HO-engagement quote${boneyardCount !== 1 ? "s" : ""} hidden`}
          </span>
          <button
            onClick={() => setShowBoneyard(v => !v)}
            className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              showBoneyard
                ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
            }`}
          >
            {showBoneyard ? "Hide Boneyard Quotes" : "Show Boneyard Quotes"}
          </button>
        </div>
      )}
    </div>
  );
}