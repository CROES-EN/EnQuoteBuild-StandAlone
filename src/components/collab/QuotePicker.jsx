import {useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {getQuotes} from "@/api/dataClient";
import {Input} from "@/components/ui/input";
import {Loader2, Search} from "lucide-react";

export function quoteLabel(quote) {
  return quote?.quote_number ? String(quote.quote_number) : `Draft${quote?.site_id ? ` (Site ${quote.site_id})` : ""}`;
}

export function quoteSublabel(quote) {
  return [quote?.site_id && `Site ${quote.site_id}`, quote?.case_number && `Case ${quote.case_number}`, quote?.status]
    .filter(Boolean)
    .join(" \u00b7 ");
}

export function quoteAttachment(quote) {
  return {
    type: "quote",
    quoteId: String(quote.id),
    label: quoteLabel(quote).slice(0, 200),
    sublabel: quoteSublabel(quote).slice(0, 200)
  };
}

// Searchable list of current quotes (by quote number, site, case, or requester).
export default function QuotePicker({ onPick, excludeIds = [] }) {
  const [search, setSearch] = useState("");
  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes", "picker"],
    queryFn: async () => (await getQuotes()).filter((quote) => quote.is_current_version !== false),
    staleTime: 60 * 1000
  });

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    const excluded = new Set(excludeIds.map(String));
    return quotes
      .filter((quote) => !excluded.has(String(quote.id)))
      .filter((quote) => !term || [quote.quote_number, quote.site_id, quote.case_number, quote.quote_requester]
        .some((value) => String(value || "").toLowerCase().includes(term)))
      .sort((a, b) => String(b.updated_date || b.created_date || "").localeCompare(String(a.updated_date || a.created_date || "")))
      .slice(0, 30);
  }, [quotes, search, excludeIds]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quote #, site, case..." className="pl-8" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading quotes...</div>
        ) : results.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No matching quotes.</p>
        ) : results.map((quote) => (
          <button
            key={quote.id}
            type="button"
            onClick={() => onPick(quote)}
            className="block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent"
          >
            <div className="text-sm font-medium text-foreground">{quoteLabel(quote)}</div>
            <div className="text-xs text-muted-foreground">{quoteSublabel(quote)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
