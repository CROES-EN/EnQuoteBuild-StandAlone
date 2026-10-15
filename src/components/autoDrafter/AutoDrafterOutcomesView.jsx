import {useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Download} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {AUTO_DRAFTER_OUTCOMES} from "@/features/autoDrafter/autoDrafterActivity";
import {createPageUrl} from "@/utils";

const OUTCOME_STYLES = {
  awaiting: "bg-amber-100 text-amber-800 border-amber-200",
  sent: "bg-emerald-100 text-emerald-800 border-emerald-200",
  quoted: "bg-sky-100 text-sky-800 border-sky-200",
  removed: "bg-slate-100 text-slate-700 border-slate-200"
};

const formatWhen = value => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? "" : new Date(time).toLocaleString();
};

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows) {
  const header = ["Case", "Site ID", "Outcome", "Quote", "Note", "By", "When"];
  const lines = [header, ...rows.map(row => [row.caseNumber, row.siteId, row.label, row.quoteNumber, row.note, row.by, formatWhen(row.at)])]
    .map(line => line.map(csvCell).join(","));
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], {type: "text/csv"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = `auto-drafter-outcomes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Where every Auto-Drafter case went: still awaiting review, sent/quoted, or removed with its note. */
export default function AutoDrafterOutcomesView({outcomes, search = ""}) {
  const [filter, setFilter] = useState("all");
  const counts = useMemo(() => Object.fromEntries(AUTO_DRAFTER_OUTCOMES.map(option =>
    [option.value, outcomes.filter(row => row.outcome === option.value).length])), [outcomes]);
  const shown = useMemo(() => outcomes.filter(row => (filter === "all" || row.outcome === filter) &&
    (!search || [row.caseNumber, row.siteId, row.label, row.quoteNumber, row.note, row.by, row.draftReference]
      .some(value => String(value || "").toLowerCase().includes(search)))), [outcomes, filter, search]);

  return <div className="space-y-3" data-auto-drafter-outcomes>
    <div className="flex flex-wrap items-center gap-2">
      {[{value: "all", label: "All"}, ...AUTO_DRAFTER_OUTCOMES].map(option => <Button key={option.value} size="sm"
        variant={filter === option.value ? "default" : "outline"} data-outcome-filter={option.value}
        onClick={() => setFilter(option.value)}>
        {option.label} ({option.value === "all" ? outcomes.length : counts[option.value]})
      </Button>)}
      <Button size="sm" variant="outline" className="ml-auto" disabled={!shown.length} onClick={() => downloadCsv(shown)}>
        <Download className="w-4 h-4 mr-2"/>Export CSV ({shown.length})
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">Every case Auto-Drafter drafted or removed and where it went. Drafts count toward Quotes Created and removals toward Quotes Worked on the Supervisor Dashboard.</p>
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Case</TableHead><TableHead>Site</TableHead><TableHead>Outcome</TableHead>
          <TableHead>Quote / Note</TableHead><TableHead>By</TableHead><TableHead>When</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {shown.map(row => <TableRow key={row.caseNumber} data-outcome-case={row.caseNumber} data-outcome={row.outcome}>
            <TableCell className="font-medium">
              <Link className="text-indigo-600 hover:underline" to={createPageUrl(`AutoDrafter?draftCase=${encodeURIComponent(row.caseNumber)}`)}>#{row.caseNumber}</Link>
              {row.draftReference && <p className="text-xs text-muted-foreground">{row.draftReference}</p>}
            </TableCell>
            <TableCell>{row.siteId || "—"}</TableCell>
            <TableCell><Badge variant="outline" className={OUTCOME_STYLES[row.outcome]}>{row.label}</Badge></TableCell>
            <TableCell className="max-w-sm">
              {row.quoteNumber && (row.quoteId
                ? <Link className="text-indigo-600 hover:underline" to={createPageUrl(`QuoteDetails?id=${encodeURIComponent(row.quoteId)}`)}>{row.quoteNumber}</Link>
                : <span>{row.quoteNumber}</span>)}
              {row.note && <p className="text-sm whitespace-pre-wrap">{row.note}</p>}
              {!row.quoteNumber && !row.note && <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="text-sm">{row.by || "—"}</TableCell>
            <TableCell className="text-sm whitespace-nowrap">{formatWhen(row.at) || "—"}</TableCell>
          </TableRow>)}
          {!shown.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
            {outcomes.length ? "No cases match this filter." : "No Auto-Drafter cases have been drafted or removed yet."}
          </TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  </div>;
}
