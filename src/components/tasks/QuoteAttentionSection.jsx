import {useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {useQuery} from "@tanstack/react-query";
import {ExternalLink, FileText, Settings2} from "lucide-react";
import {getQuotes} from "@/api/dataClient";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {Checkbox} from "@/components/ui/checkbox";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import StatusBadge from "@/components/quotes/StatusBadge";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";
import {createPageUrl} from "@/utils";
import {cn} from "@/lib/utils";
import {
  QUOTE_ATTENTION_STATUS_OPTIONS,
  readQuoteAttentionPrefs,
  selectQuotesNeedingAttention,
  writeQuoteAttentionPrefs
} from "@/features/tasks/quoteAttention";

function QuoteAttentionSettings({ open, onOpenChange, prefs, onSave }) {
  const [draft, setDraft] = useState(prefs);
  useEffect(() => { if (open) setDraft(prefs); }, [open, prefs]);
  const selected = new Set(draft.statuses);
  const toggle = (value, checked) => setDraft((current) => ({
    ...current,
    statuses: checked ? [...current.statuses, value] : current.statuses.filter((status) => status !== value)
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quotes needing attention</DialogTitle>
          <DialogDescription>Choose which quote statuses appear on your Tasks screen. Only you see these settings.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2" role="radiogroup" aria-label="Quotes to include">
            {[{ value: "mine", label: "My quotes" }, { value: "all", label: "All quotes" }].map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                role="radio"
                aria-checked={draft.scope === option.value}
                variant={draft.scope === option.value ? "default" : "outline"}
                onClick={() => setDraft((current) => ({ ...current, scope: option.value }))}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {QUOTE_ATTENTION_STATUS_OPTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox checked={selected.has(option.value)} onCheckedChange={(checked) => toggle(option.value, checked === true)} />
                {option.label}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onSave(draft); onOpenChange(false); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QuoteAttentionSection({ userEmail, now }) {
  const [prefs, setPrefs] = useState(() => readQuoteAttentionPrefs());
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { setPrefs(readQuoteAttentionPrefs()); }, [userEmail]);

  const enabled = prefs.statuses.length > 0;
  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes", "tasks-attention"],
    queryFn: getQuotes,
    enabled
  });
  const items = useMemo(
    () => selectQuotesNeedingAttention(quotes, prefs, userEmail, now?.getTime?.() ?? Date.now()),
    [quotes, prefs, userEmail, now]
  );
  const save = (next) => setPrefs(writeQuoteAttentionPrefs(next));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 text-indigo-500" />
          Quotes needing attention
          {enabled && <span className="text-muted-foreground">({items.length})</span>}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="mr-1 h-4 w-4" />{enabled ? "Statuses" : "Choose statuses"}
        </Button>
      </div>
      {!enabled ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Pick the quote statuses you want to keep an eye on, and matching quotes will show here automatically.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading quotes...</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No {prefs.scope === "mine" ? "quotes of yours" : "quotes"} are in the selected statuses.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(({ quote, status, daysInStatus }) => (
            <Card key={quote.id}>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
                <Link to={createPageUrl(`QuoteDetails?id=${encodeURIComponent(quote.id)}`)} className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline">
                  {quote.quote_number || "Quote"}<ExternalLink className="h-3 w-3" />
                </Link>
                <StatusBadge status={status} size="sm" />
                {quote.site_id && <span className="text-muted-foreground">Site <SiteIdLink siteId={quote.site_id} /></span>}
                {quote.case_number && <span className="text-muted-foreground">Case <CaseNumberLink caseNumber={quote.case_number} /></span>}
                {prefs.scope === "all" && <span className="text-xs text-muted-foreground">{quote.owner_email || quote.created_by}</span>}
                {daysInStatus !== null && (
                  <span className={cn("ml-auto text-xs", daysInStatus >= 7 ? "font-semibold text-red-600" : "text-muted-foreground")}>
                    {daysInStatus === 0 ? "Today" : `${daysInStatus}d in status`}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <QuoteAttentionSettings open={settingsOpen} onOpenChange={setSettingsOpen} prefs={prefs} onSave={save} />
    </div>
  );
}
