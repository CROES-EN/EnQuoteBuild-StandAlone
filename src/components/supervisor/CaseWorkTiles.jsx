import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {ClipboardList} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";
import {DEFAULT_CASE_WORK_TEAM} from "@/features/supervisorDashboard/caseWorkMetrics";
import {onUserSessionChanged, scopedKey} from "@/lib/userScopedStorage";
import {isReadonlyViewing} from "@/features/admin/readonlyViewing";
import {AGGREGATION_MODE_OPTIONS} from "@/features/supervisorDashboard/periodAggregation";
import {getStatusLabel} from "@/constants/quoteStatuses";
import {createPageUrl} from "@/utils";
import {getQuotePaidDate, hasValidQuoteTotal} from "@/features/supervisorDashboard/paidQuoteMetrics";

const TEAM_KEY = "enquote_case_work_team_v1";

export function readCaseWorkTeam() {
  const raw = globalThis.window?.localStorage?.getItem(scopedKey(TEAM_KEY));
  if (!raw) return DEFAULT_CASE_WORK_TEAM;
  const team = JSON.parse(raw);
  if (!Array.isArray(team) || !team.length || team.some(member => typeof member !== "string" || !member.trim())) {
    throw new Error("Saved case-work team is invalid. Clear the case-work team preference before continuing.");
  }
  return team;
}

export function CaseWorkSettings({team, onChange}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => onUserSessionChanged(() => {setOpen(false); setDraft("");}), []);
  function save() {
    if (isReadonlyViewing()) return toast.error("Team settings cannot be changed in viewing mode.");
    const members = [...new Set(draft.split("\n").map(value => value.trim()).filter(Boolean))];
    if (!members.length) return toast.error("Enter at least one team member.");
    try {
      if (!globalThis.window?.localStorage) throw new Error("Preference storage is unavailable.");
      window.localStorage.setItem(scopedKey(TEAM_KEY), JSON.stringify(members));
      onChange(members);
      setOpen(false);
    } catch (error) {toast.error(error.message);}
  }
  return <>
    <Button variant="outline" disabled={isReadonlyViewing()} onClick={() => {setDraft(team.join("\n")); setOpen(true);}}>Case-work team</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Case-work team</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Match Salesforce owner names, one per line. Used for historical ownership, not Edited By or current Case Owner. Saved for this account on this device; changes recalculate all selected history.</p>
        <Label htmlFor="case-work-team">Team members</Label>
        <Textarea id="case-work-team" rows={12} value={draft} onChange={event => setDraft(event.target.value)} />
        <Button onClick={save}>Save team</Button>
      </DialogContent>
    </Dialog>
  </>;
}

export default function CaseWorkTile({label, value, subtitle, records = [], loading, error, onRetry, unavailable, mode, modeLabel, payment = false, quotes = false, currency}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(100);
  const formatted = value === null || value === undefined ? "Unavailable" : currency ?
    new Intl.NumberFormat(undefined, {style: "currency", currency}).format(value) :
    new Intl.NumberFormat(undefined, {maximumFractionDigits: 2}).format(value);
  return <div className="rounded-xl border border-border bg-secondary p-4">
    <ClipboardList className="h-5 w-5 text-primary" />
    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    {error ? <div role="alert" className="space-y-2">
      <p className="text-sm text-destructive">{error.message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try Again</Button>
    </div> : loading ? <p role="status">Loading report...</p> : unavailable ?
      <p className="mt-2 text-sm text-muted-foreground">{unavailable}</p> :
      <p className="mt-1 text-3xl font-bold text-foreground">{formatted}</p>}
    <p className="mt-2 text-xs text-muted-foreground">{modeLabel || AGGREGATION_MODE_OPTIONS.find(option => option.value === mode)?.label}</p>
    <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    {!error && !loading && !unavailable && <Button size="sm" variant="link" className="mt-2 px-0" onClick={() => {setLimit(100); setOpen(true);}}>View contributing records</Button>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-auto">
        <DialogHeader><DialogTitle>{label} - contributing records</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{subtitle} {records.length} contributing rows. {quotes ? "Each current quote is counted once." : "Distinct-case counts may be smaller than the number of events."}</p>
        <Table>
          <TableHeader><TableRow>
            {(quotes ? ["Quote", "Status", "Paid Date", "Quote Total (USD)", "Case", "Site"] : payment ? ["Invoice", "Paid Date", "Amount Paid", "Currency", "Case", "Site"] :
              ["Case", "Site", "Edit Date", "Event", "Old Value", "New Value", "Edited By", "Qualification / Review Reason"])
              .map(header => <TableHead key={header}>{header}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>{records.slice(0, limit).map((event, index) => <TableRow key={`${event.key || event.id || "invalid"}:${index}`}>
            {quotes ? <>
              <TableCell><Link className="text-primary underline" to={createPageUrl(`QuoteDetails?id=${encodeURIComponent(event.id)}`)}>{event.quote_number || event.id}</Link></TableCell>
              <TableCell>{getStatusLabel(event.status) || event.status}</TableCell>
              <TableCell>{getQuotePaidDate(event)}</TableCell>
              <TableCell>{!hasValidQuoteTotal(event) ? "Missing/invalid total" : new Intl.NumberFormat(undefined, {style: "currency", currency: "USD"}).format(Number(event.total))}</TableCell>
              <TableCell><CaseNumberLink caseNumber={event.case_number} /></TableCell>
              <TableCell><SiteIdLink siteId={event.site_id} /></TableCell>
            </> : payment ? <>
              <TableCell>{event.row["Invoice ID"]}</TableCell>
              <TableCell>{event.row["Paid Date"]}</TableCell>
              <TableCell>{event.row["Amount Paid"]}</TableCell>
              <TableCell>{event.row.Currency}</TableCell>
              <TableCell><CaseNumberLink caseNumber={event.row["Case Number"]} /></TableCell>
              <TableCell><SiteIdLink siteId={event.row["Enlighten Site ID"]} /></TableCell>
            </> : <>
              <TableCell><CaseNumberLink caseNumber={event.caseNumber} /></TableCell>
              <TableCell><SiteIdLink siteId={event.siteId} /></TableCell>
              <TableCell>{event.row["Edit Date"]}</TableCell>
              <TableCell>{event.row["Field / Event"]}</TableCell>
              <TableCell>{event.oldValue}</TableCell>
              <TableCell>{event.newValue}</TableCell>
              <TableCell>{event.actor}</TableCell>
              <TableCell>{event.reason}</TableCell>
            </>}
          </TableRow>)}</TableBody>
        </Table>
        {records.length === 0 && <p className="text-sm text-muted-foreground">No contributing records in this period.</p>}
        {records.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 100)}>Show 100 more</Button>}
      </DialogContent>
    </Dialog>
  </div>;
}
