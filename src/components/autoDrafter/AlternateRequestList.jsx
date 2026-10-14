import {useState} from "react";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Calendar, Inbox, User} from "lucide-react";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";
import {ALTERNATE_REQUEST_TYPES} from "@/features/quoteRequestIntake/quoteRequestComment";

const TONES = {
  care_cancellation: "bg-rose-50 text-rose-700 border-rose-200",
  escalation: "bg-amber-50 text-amber-800 border-amber-200",
  return: "bg-sky-50 text-sky-700 border-sky-200"
};

export default function AlternateRequestList({entries}) {
  const [type, setType] = useState("all");
  const counts = Object.fromEntries(ALTERNATE_REQUEST_TYPES.map(option =>
    [option.value, entries.filter(entry => entry.type.value === option.value).length]));
  const shown = type === "all" ? entries : entries.filter(entry => entry.type.value === type);
  return <div className="space-y-3" data-alternate-requests>
    <p className="text-sm text-muted-foreground">O&amp;M Care Cancellation, Escalation and Return comments are not quote requests. They are listed here and never drafted, quoted or counted in Data Hygiene.</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter alternate requests">
      {[{value: "all", label: "All"}, ...ALTERNATE_REQUEST_TYPES].map(option => <button key={option.value} type="button"
        data-alternate-filter={option.value} aria-pressed={type === option.value} onClick={() => setType(option.value)}
        className={`rounded-full border px-3 py-1 text-xs font-medium ${type === option.value ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
        {option.label} ({option.value === "all" ? entries.length : counts[option.value]})
      </button>)}
    </div>
    {shown.length === 0 ? <Card className="p-12 text-center border-border">
      <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-4"/>
      <h3 className="text-lg font-semibold text-foreground mb-2">No alternate requests</h3>
      <p className="text-muted-foreground">No Care Cancellation, Escalation or Return comments match.</p>
    </Card> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {shown.map(entry => <Card key={entry.key} className="p-4 space-y-2 border-border" data-alternate-request={entry.type.value}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold">Case #<CaseNumberLink caseNumber={entry.caseNumber} fallback="No reference" /></div>
          <Badge variant="outline" className={TONES[entry.type.value]}>{entry.type.label}</Badge>
        </div>
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
          <span>{entry.siteId ? <>Site <SiteIdLink siteId={entry.siteId} /></> : "No site ID"}</span>
          {entry.author && <span className="inline-flex items-center gap-1"><User className="w-3 h-3"/>{entry.author}</span>}
          {entry.created && <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3"/>{entry.created}</span>}
          {entry.status && <span>{entry.status}</span>}
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-primary">Show comment</summary>
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs font-sans">{entry.comment}</pre>
        </details>
      </Card>)}
    </div>}
  </div>;
}
